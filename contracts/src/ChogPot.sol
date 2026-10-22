// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title ChogPot: the optional Daily Pot for Chogsweeper.
/// @notice Players pay at least minEntry of one token (CHOG) to join the current UTC day's pot.
/// After the day ends the settler (the game server's wallet) posts up to 3 winners in rank order.
/// Winners pull their share with claim(). If the settler does nothing for 7 days after the day
/// ends, anyone can open refunds and every entrant pulls their own entry back.
///
/// Money rules, all enforced here and not by the server:
/// - Nobody can withdraw pot money except winners (their share) and entrants (their own refund).
/// - The owner can change the settler, the minimum for future days, and pause new entries. Nothing else.
/// - The settler can only name winners who entered that day. It cannot move money anywhere else.
/// - No fee.
contract ChogPot is Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// Days the settler has after a day ends. After that only refunds are possible.
    uint256 public constant SETTLE_WINDOW = 7 days;
    uint256 public constant MAX_WINNERS = 3;
    uint256 private constant BPS = 10_000;

    struct Day {
        uint256 entries; // sum of entry amounts paid in on this day
        uint256 carriedIn; // money rolled in from earlier days
        uint32 entrantCount;
        bool settled; // winners posted, or zero winners and the pot rolled on
        bool refundOpen; // settle window passed with no settlement, entrants may pull back
    }

    IERC20 public immutable token;
    address public settler;

    // Minimum entry. A change never touches today or any past day: it starts on the next UTC day.
    uint256 private _minEntry;
    uint256 private _pendingMinEntry;
    uint256 private _pendingFromDay; // 0 means no change waiting

    mapping(uint256 day => Day) private _days;
    mapping(uint256 day => mapping(address player => uint256 amount)) private _entryOf;
    mapping(uint256 day => mapping(address player => bool)) private _refundTaken;
    mapping(uint256 day => address[]) private _winners;
    mapping(uint256 day => uint256[]) private _prizes;
    mapping(address player => uint256 amount) private _claimable;

    event Entered(uint256 indexed day, address indexed player, uint256 amount);
    event Settled(uint256 indexed day, address[] winners, uint256[] amounts, uint256 pot);
    event Claimed(address indexed player, uint256 amount);
    event RolledOver(uint256 indexed fromDay, uint256 indexed toDay, uint256 amount);
    event RefundOpened(uint256 indexed day);
    event Refunded(uint256 indexed day, address indexed player, uint256 amount);
    event SettlerChanged(address indexed previousSettler, address indexed newSettler);
    event MinEntryScheduled(uint256 amount, uint256 fromDay);

    error ZeroAddress();
    error ZeroAmount();
    error WrongDay(uint256 given, uint256 today);
    error BelowMinEntry(uint256 amount, uint256 minEntry);
    error AlreadyEntered();
    error SettlerCannotEnter();
    error FeeOnTransferNotSupported(uint256 sent, uint256 received);
    error NotSettler();
    error DayNotOver();
    error SettleWindowClosed();
    error AlreadySettled();
    error RefundIsOpen();
    error TooManyWinners();
    error NotAnEntrant(address who);
    error DuplicateWinner(address who);
    error NothingToClaim();
    error RefundNotAllowedYet();
    error RefundNotOpen();
    error AlreadyRefunded();
    error NothingToRefund();
    error RenounceDisabled();

    constructor(IERC20 token_, address settler_, uint256 minEntry_) Ownable(msg.sender) {
        if (address(token_) == address(0) || settler_ == address(0)) revert ZeroAddress();
        if (minEntry_ == 0) revert ZeroAmount();
        token = token_;
        settler = settler_;
        _minEntry = minEntry_;
        emit SettlerChanged(address(0), settler_);
        emit MinEntryScheduled(minEntry_, currentDay());
    }

    /// Ownership can be handed over, never thrown away. If the owner could renounce after pausing,
    /// new entries would stay blocked forever and the settler could never be replaced.
    function renounceOwnership() public pure override {
        revert RenounceDisabled();
    }

    // ---------------------------------------------------------------- players

    /// @notice Join today's pot. `day` must equal today, so a transaction that lands after
    /// midnight fails instead of quietly joining the wrong day. Approve the token first.
    function enter(uint256 day, uint256 amount) external nonReentrant whenNotPaused {
        uint256 today = currentDay();
        if (day != today) revert WrongDay(day, today);
        if (msg.sender == settler) revert SettlerCannotEnter();
        uint256 min = minEntryFor(today);
        if (amount < min) revert BelowMinEntry(amount, min);
        if (_entryOf[today][msg.sender] != 0) revert AlreadyEntered();

        // Count what really arrived. A token that skims a fee on transfer is refused, because
        // the pot would then promise more than it holds.
        uint256 before = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = token.balanceOf(address(this)) - before;
        if (received != amount) revert FeeOnTransferNotSupported(amount, received);

        _entryOf[today][msg.sender] = amount;
        Day storage d = _days[today];
        d.entries += amount;
        d.entrantCount += 1;
        emit Entered(today, msg.sender, amount);
    }

    /// @notice Pull everything you have won, across all days.
    function claim() external nonReentrant {
        uint256 amount = _claimable[msg.sender];
        if (amount == 0) revert NothingToClaim();
        _claimable[msg.sender] = 0;
        token.safeTransfer(msg.sender, amount);
        emit Claimed(msg.sender, amount);
    }

    // ---------------------------------------------------------------- settler

    /// @notice Post the winners of a finished day, best first. Up to 3, each a real entrant
    /// of that day, no repeats. Zero winners rolls the whole pot into today's pot.
    /// One time only: a settled day can never be changed.
    function settle(uint256 day, address[] calldata winners) external nonReentrant {
        if (msg.sender != settler) revert NotSettler();
        uint256 today = currentDay();
        if (day >= today) revert DayNotOver();
        if (block.timestamp >= dayEnd(day) + SETTLE_WINDOW) revert SettleWindowClosed();
        Day storage d = _days[day];
        if (d.settled) revert AlreadySettled();
        if (d.refundOpen) revert RefundIsOpen(); // cannot happen inside the window, kept as a guard
        uint256 n = winners.length;
        if (n > MAX_WINNERS) revert TooManyWinners();

        for (uint256 i = 0; i < n; i++) {
            address w = winners[i];
            if (_entryOf[day][w] == 0) revert NotAnEntrant(w);
            for (uint256 j = 0; j < i; j++) {
                if (winners[j] == w) revert DuplicateWinner(w);
            }
        }

        d.settled = true;
        uint256 pot = d.entries + d.carriedIn;

        if (n == 0) {
            _rollForward(day, today, pot);
            emit Settled(day, winners, new uint256[](0), pot);
            return;
        }

        uint256[] memory amounts = new uint256[](n);
        if (n == 3) {
            amounts[1] = (pot * 2_500) / BPS;
            amounts[2] = (pot * 1_500) / BPS;
        } else if (n == 2) {
            amounts[1] = (pot * 3_000) / BPS;
        }
        // First place takes the rest, which includes any rounding dust.
        uint256 rest = pot;
        for (uint256 i = 1; i < n; i++) rest -= amounts[i];
        amounts[0] = rest;

        for (uint256 i = 0; i < n; i++) {
            _claimable[winners[i]] += amounts[i];
            _winners[day].push(winners[i]);
            _prizes[day].push(amounts[i]);
        }
        emit Settled(day, winners, amounts, pot);
    }

    // ---------------------------------------------------------------- safety net

    /// @notice Anyone may call this once a day has gone unsettled for 7 days after it ended.
    /// Entrants then pull their own entry back with claimRefund(day). Money that had rolled
    /// into this day from earlier days moves on to today's pot, so it is never stuck.
    function refund(uint256 day) external nonReentrant {
        if (block.timestamp < dayEnd(day) + SETTLE_WINDOW) revert RefundNotAllowedYet();
        Day storage d = _days[day];
        if (d.settled) revert AlreadySettled();
        if (d.refundOpen) revert RefundIsOpen();
        if (d.entrantCount == 0 && d.carriedIn == 0) revert NothingToRefund();
        d.refundOpen = true;
        emit RefundOpened(day);
        if (d.carriedIn > 0) _rollForward(day, currentDay(), d.carriedIn);
    }

    /// @notice Pull your own entry back from a day whose refund is open.
    function claimRefund(uint256 day) external nonReentrant {
        if (!_days[day].refundOpen) revert RefundNotOpen();
        uint256 amount = _entryOf[day][msg.sender];
        if (amount == 0) revert NotAnEntrant(msg.sender);
        if (_refundTaken[day][msg.sender]) revert AlreadyRefunded();
        _refundTaken[day][msg.sender] = true;
        token.safeTransfer(msg.sender, amount);
        emit Refunded(day, msg.sender, amount);
    }

    // ---------------------------------------------------------------- owner

    function setSettler(address newSettler) external onlyOwner {
        if (newSettler == address(0)) revert ZeroAddress();
        emit SettlerChanged(settler, newSettler);
        settler = newSettler;
    }

    /// @notice Set the minimum entry. It takes effect from the next UTC day, never today.
    function setMinEntry(uint256 amount) external onlyOwner {
        if (amount == 0) revert ZeroAmount();
        uint256 today = currentDay();
        // A waiting change that has already started becomes the base value first.
        if (_pendingFromDay != 0 && today >= _pendingFromDay) _minEntry = _pendingMinEntry;
        _pendingMinEntry = amount;
        _pendingFromDay = today + 1;
        emit MinEntryScheduled(amount, today + 1);
    }

    /// @notice Stops new entries only. Claims, refunds and settling keep working.
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ---------------------------------------------------------------- views for the website

    function currentDay() public view returns (uint256) {
        return block.timestamp / 1 days;
    }

    /// @notice Unix time when `day` ends (start of the next UTC day).
    function dayEnd(uint256 day) public pure returns (uint256) {
        return (day + 1) * 1 days;
    }

    /// @notice The minimum entry that applies on `day`. Only meaningful for today and later.
    function minEntryFor(uint256 day) public view returns (uint256) {
        if (_pendingFromDay != 0 && day >= _pendingFromDay) return _pendingMinEntry;
        return _minEntry;
    }

    /// @notice The minimum entry for today.
    function minEntry() external view returns (uint256) {
        return minEntryFor(currentDay());
    }

    /// @notice Total pot of a day: entries plus anything rolled in.
    function potSize(uint256 day) external view returns (uint256) {
        Day storage d = _days[day];
        return d.entries + d.carriedIn;
    }

    function dayInfo(uint256 day)
        external
        view
        returns (uint256 entries, uint256 carriedIn, uint256 entrants, bool settled, bool refundOpen)
    {
        Day storage d = _days[day];
        return (d.entries, d.carriedIn, d.entrantCount, d.settled, d.refundOpen);
    }

    function entrantCount(uint256 day) external view returns (uint256) {
        return _days[day].entrantCount;
    }

    function hasEntered(uint256 day, address player) external view returns (bool) {
        return _entryOf[day][player] != 0;
    }

    function entryOf(uint256 day, address player) external view returns (uint256) {
        return _entryOf[day][player];
    }

    function isSettled(uint256 day) external view returns (bool) {
        return _days[day].settled;
    }

    function isRefundOpen(uint256 day) external view returns (bool) {
        return _days[day].refundOpen;
    }

    function refundTaken(uint256 day, address player) external view returns (bool) {
        return _refundTaken[day][player];
    }

    function claimable(address player) external view returns (uint256) {
        return _claimable[player];
    }

    function winnersOf(uint256 day) external view returns (address[] memory winners, uint256[] memory amounts) {
        return (_winners[day], _prizes[day]);
    }

    // ---------------------------------------------------------------- internal

    // The target is always today, which is still open: it cannot be settled or refunded yet,
    // so rolled money can never land in a closed day and get stuck.
    function _rollForward(uint256 fromDay, uint256 toDay, uint256 amount) private {
        if (amount == 0) return;
        _days[toDay].carriedIn += amount;
        emit RolledOver(fromDay, toDay, amount);
    }
}
