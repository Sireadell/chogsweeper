// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// Test tokens only. Never deploy these anywhere that holds real money.

/// Plain token that anyone can mint. Stands in for CHOG in tests and on testnet.
contract MockERC20 is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// Takes 1 percent of every transfer, to prove the pot refuses such tokens.
contract FeeOnTransferToken is ERC20 {
    constructor() ERC20("Fee Token", "FEE") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            uint256 fee = value / 100;
            super._update(from, address(0xdead), fee);
            super._update(from, to, value - fee);
        } else {
            super._update(from, to, value);
        }
    }
}

/// When armed, calls back into a target during any transfer sent by that target,
/// to prove every money-moving function blocks re-entry.
contract ReentrantToken is ERC20 {
    address public target;
    bytes public payload;
    bool public armed;

    constructor() ERC20("Reentrant Token", "RE") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function arm(address target_, bytes calldata payload_) external {
        target = target_;
        payload = payload_;
        armed = true;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (armed && from == target) {
            armed = false;
            (bool ok, bytes memory ret) = target.call(payload);
            if (!ok) {
                assembly {
                    revert(add(ret, 32), mload(ret))
                }
            }
        }
    }
}

/// Records what the pot says a player can still claim at the moment their payout is sent.
/// A correct pot has already set it to zero by then.
contract ObserverToken is ERC20 {
    address public target;
    bool public watching;
    bool public observed;
    uint256 public seen;

    constructor() ERC20("Observer Token", "OBS") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function watch(address target_) external {
        target = target_;
        watching = true;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (watching && from == target) {
            watching = false;
            (bool ok, bytes memory ret) = target.staticcall(abi.encodeWithSignature("claimable(address)", to));
            if (ok) {
                seen = abi.decode(ret, (uint256));
                observed = true;
            }
        }
    }
}
