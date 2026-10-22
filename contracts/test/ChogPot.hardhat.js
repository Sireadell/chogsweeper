const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const fs = require("node:fs");
const path = require("node:path");

const DAY = 86_400n;
const E = (n) => ethers.parseUnits(String(n), 18);
const MIN = E(100);

// Move the chain clock to `secondsIntoDay` of UTC day `day`.
async function goTo(day, secondsIntoDay = 3600n) {
  await time.increaseTo(day * DAY + secondsIntoDay);
}

async function deploy() {
  const [owner, settler, a, b, c, d, e, stranger] = await ethers.getSigners();
  const Token = await ethers.getContractFactory("MockERC20");
  const token = await Token.deploy("Test CHOG", "tCHOG");
  const Pot = await ethers.getContractFactory("ChogPot");
  const pot = await Pot.deploy(await token.getAddress(), settler.address, MIN);
  for (const p of [a, b, c, d, e, stranger, settler, owner]) {
    await token.mint(p.address, E(1_000_000));
    await token.connect(p).approve(await pot.getAddress(), ethers.MaxUint256);
  }
  // Start every test at 01:00 UTC of a fresh day so day maths is predictable.
  const day0 = (BigInt(await time.latest()) / DAY) + 2n;
  await goTo(day0);
  return { token, pot, owner, settler, a, b, c, d, e, stranger, day0 };
}

describe("ChogPot", function () {
  describe("deploy", function () {
    it("rejects zero token, zero settler and zero minimum", async function () {
      const [, s] = await ethers.getSigners();
      const Pot = await ethers.getContractFactory("ChogPot");
      const tok = (await (await ethers.getContractFactory("MockERC20")).deploy("x", "x")).target;
      await expect(Pot.deploy(ethers.ZeroAddress, s.address, 1)).to.be.revertedWithCustomError(Pot, "ZeroAddress");
      await expect(Pot.deploy(tok, ethers.ZeroAddress, 1)).to.be.revertedWithCustomError(Pot, "ZeroAddress");
      await expect(Pot.deploy(tok, s.address, 0)).to.be.revertedWithCustomError(Pot, "ZeroAmount");
    });

    it("starts with the right settings", async function () {
      const { pot, token, owner, settler, day0 } = await loadFixture(deploy);
      expect(await pot.token()).to.equal(await token.getAddress());
      expect(await pot.owner()).to.equal(owner.address);
      expect(await pot.settler()).to.equal(settler.address);
      expect(await pot.minEntry()).to.equal(MIN);
      expect(await pot.currentDay()).to.equal(day0);
    });

    it("has no function that lets owner or settler take money out", async function () {
      const { pot } = await loadFixture(deploy);
      const writes = pot.interface.fragments
        .filter((f) => f.type === "function" && !["view", "pure"].includes(f.stateMutability))
        .map((f) => f.name)
        .sort();
      expect(writes).to.deep.equal([
        "acceptOwnership", "claim", "claimRefund", "enter", "pause", "refund",
        "setMinEntry", "setSettler", "settle", "transferOwnership", "unpause",
      ]);
    });
  });

  describe("enter", function () {
    it("takes the entry and records it", async function () {
      const { pot, token, a, day0 } = await loadFixture(deploy);
      await expect(pot.connect(a).enter(day0, MIN)).to.emit(pot, "Entered").withArgs(day0, a.address, MIN);
      expect(await token.balanceOf(await pot.getAddress())).to.equal(MIN);
      expect(await pot.hasEntered(day0, a.address)).to.equal(true);
      expect(await pot.entryOf(day0, a.address)).to.equal(MIN);
      expect(await pot.entrantCount(day0)).to.equal(1);
      expect(await pot.potSize(day0)).to.equal(MIN);
    });

    it("lets a player pay more than the minimum", async function () {
      const { pot, a, day0 } = await loadFixture(deploy);
      await pot.connect(a).enter(day0, E(250));
      expect(await pot.potSize(day0)).to.equal(E(250));
    });

    it("refuses less than the minimum", async function () {
      const { pot, a, day0 } = await loadFixture(deploy);
      await expect(pot.connect(a).enter(day0, MIN - 1n)).to.be.revertedWithCustomError(pot, "BelowMinEntry");
    });

    it("refuses a second entry from the same wallet on the same day", async function () {
      const { pot, a, day0 } = await loadFixture(deploy);
      await pot.connect(a).enter(day0, MIN);
      await expect(pot.connect(a).enter(day0, MIN)).to.be.revertedWithCustomError(pot, "AlreadyEntered");
    });

    it("allows the same wallet again the next day", async function () {
      const { pot, a, day0 } = await loadFixture(deploy);
      await pot.connect(a).enter(day0, MIN);
      await goTo(day0 + 1n);
      await pot.connect(a).enter(day0 + 1n, MIN);
      expect(await pot.hasEntered(day0 + 1n, a.address)).to.equal(true);
    });

    it("only accepts today: not yesterday, not tomorrow", async function () {
      const { pot, a, day0 } = await loadFixture(deploy);
      await expect(pot.connect(a).enter(day0 - 1n, MIN)).to.be.revertedWithCustomError(pot, "WrongDay");
      await expect(pot.connect(a).enter(day0 + 1n, MIN)).to.be.revertedWithCustomError(pot, "WrongDay");
    });

    it("a transaction aimed at today fails if it lands after midnight", async function () {
      const { pot, a, day0 } = await loadFixture(deploy);
      await goTo(day0 + 1n, 1n);
      await expect(pot.connect(a).enter(day0, MIN)).to.be.revertedWithCustomError(pot, "WrongDay");
    });

    it("the settler cannot enter", async function () {
      const { pot, settler, day0 } = await loadFixture(deploy);
      await expect(pot.connect(settler).enter(day0, MIN)).to.be.revertedWithCustomError(pot, "SettlerCannotEnter");
    });

    it("fails without an approval", async function () {
      const { pot, token, a, day0 } = await loadFixture(deploy);
      await token.connect(a).approve(await pot.getAddress(), 0);
      await expect(pot.connect(a).enter(day0, MIN)).to.be.reverted;
    });

    it("rejects a token that skims a fee on transfer", async function () {
      const [, settler, a] = await ethers.getSigners();
      const fee = await (await ethers.getContractFactory("FeeOnTransferToken")).deploy();
      const pot = await (await ethers.getContractFactory("ChogPot")).deploy(await fee.getAddress(), settler.address, MIN);
      await fee.mint(a.address, E(1000));
      await fee.connect(a).approve(await pot.getAddress(), ethers.MaxUint256);
      const today = await pot.currentDay();
      await expect(pot.connect(a).enter(today, MIN))
        .to.be.revertedWithCustomError(pot, "FeeOnTransferNotSupported")
        .withArgs(MIN, MIN - MIN / 100n);
    });
  });

  describe("pause", function () {
    it("blocks new entries and only new entries", async function () {
      const { pot, owner, settler, a, b, day0 } = await loadFixture(deploy);
      await pot.connect(a).enter(day0, MIN);
      await pot.connect(owner).pause();
      await expect(pot.connect(b).enter(day0, MIN)).to.be.revertedWithCustomError(pot, "EnforcedPause");
      await goTo(day0 + 1n);
      await pot.connect(settler).settle(day0, [a.address]); // settle still works
      await pot.connect(a).claim(); // claim still works
      await pot.connect(owner).unpause();
      await pot.connect(b).enter(day0 + 1n, MIN);
    });

    it("does not block refunds", async function () {
      const { pot, owner, a, day0 } = await loadFixture(deploy);
      await pot.connect(a).enter(day0, MIN);
      await pot.connect(owner).pause();
      await goTo(day0 + 8n);
      await pot.connect(a).refund(day0);
      await expect(pot.connect(a).claimRefund(day0)).to.emit(pot, "Refunded");
    });

    it("only the owner can pause", async function () {
      const { pot, stranger } = await loadFixture(deploy);
      await expect(pot.connect(stranger).pause()).to.be.revertedWithCustomError(pot, "OwnableUnauthorizedAccount");
    });
  });

  describe("settle", function () {
    async function threeEntered() {
      const f = await deploy();
      await f.pot.connect(f.a).enter(f.day0, MIN);
      await f.pot.connect(f.b).enter(f.day0, MIN);
      await f.pot.connect(f.c).enter(f.day0, MIN);
      await f.pot.connect(f.d).enter(f.day0, MIN);
      return f;
    }

    it("splits 60 / 25 / 15 for three winners", async function () {
      const { pot, settler, a, b, c, day0 } = await loadFixture(threeEntered);
      await goTo(day0 + 1n);
      const pot400 = E(400);
      await expect(pot.connect(settler).settle(day0, [b.address, a.address, c.address]))
        .to.emit(pot, "Settled")
        .withArgs(day0, [b.address, a.address, c.address], [E(240), E(100), E(60)], pot400);
      expect(await pot.claimable(b.address)).to.equal(E(240));
      expect(await pot.claimable(a.address)).to.equal(E(100));
      expect(await pot.claimable(c.address)).to.equal(E(60));
      expect(await pot.isSettled(day0)).to.equal(true);
      const [w, amt] = await pot.winnersOf(day0);
      expect(w).to.deep.equal([b.address, a.address, c.address]);
      expect(amt).to.deep.equal([E(240), E(100), E(60)]);
    });

    it("splits 70 / 30 for two winners", async function () {
      const { pot, settler, a, b, day0 } = await loadFixture(threeEntered);
      await goTo(day0 + 1n);
      await pot.connect(settler).settle(day0, [a.address, b.address]);
      expect(await pot.claimable(a.address)).to.equal(E(280));
      expect(await pot.claimable(b.address)).to.equal(E(120));
    });

    it("gives everything to one winner", async function () {
      const { pot, settler, d, day0 } = await loadFixture(threeEntered);
      await goTo(day0 + 1n);
      await pot.connect(settler).settle(day0, [d.address]);
      expect(await pot.claimable(d.address)).to.equal(E(400));
    });

    it("gives rounding dust to first place and pays out exactly the pot", async function () {
      const { pot, settler, a, b, c, day0 } = await loadFixture(deploy);
      // 100e18 + 1, 100e18 + 1, 100e18 + 1: a pot that does not divide evenly
      await pot.connect(a).enter(day0, MIN + 1n);
      await pot.connect(b).enter(day0, MIN + 1n);
      await pot.connect(c).enter(day0, MIN + 1n);
      const total = 3n * (MIN + 1n);
      await goTo(day0 + 1n);
      await pot.connect(settler).settle(day0, [a.address, b.address, c.address]);
      const second = (total * 2500n) / 10000n;
      const third = (total * 1500n) / 10000n;
      expect(await pot.claimable(b.address)).to.equal(second);
      expect(await pot.claimable(c.address)).to.equal(third);
      expect(await pot.claimable(a.address)).to.equal(total - second - third);
      expect((await pot.claimable(a.address)) + second + third).to.equal(total);
    });

    it("works for a day with a single entrant", async function () {
      const { pot, token, settler, a, day0 } = await loadFixture(deploy);
      await pot.connect(a).enter(day0, E(123));
      await goTo(day0 + 1n);
      await pot.connect(settler).settle(day0, [a.address]);
      const before = await token.balanceOf(a.address);
      await pot.connect(a).claim();
      expect((await token.balanceOf(a.address)) - before).to.equal(E(123));
      expect(await token.balanceOf(await pot.getAddress())).to.equal(0);
    });

    it("only the settler can settle, not the owner", async function () {
      const { pot, owner, a, day0 } = await loadFixture(threeEntered);
      await goTo(day0 + 1n);
      await expect(pot.connect(owner).settle(day0, [a.address])).to.be.revertedWithCustomError(pot, "NotSettler");
      await expect(pot.connect(a).settle(day0, [a.address])).to.be.revertedWithCustomError(pot, "NotSettler");
    });

    it("refuses a day that has not ended", async function () {
      const { pot, settler, a, day0 } = await loadFixture(threeEntered);
      await expect(pot.connect(settler).settle(day0, [a.address])).to.be.revertedWithCustomError(pot, "DayNotOver");
      await goTo(day0, DAY - 5n); // 23:59:55, still the same day
      await expect(pot.connect(settler).settle(day0, [a.address])).to.be.revertedWithCustomError(pot, "DayNotOver");
      await expect(pot.connect(settler).settle(day0 + 5n, [])).to.be.revertedWithCustomError(pot, "DayNotOver");
    });

    it("refuses a winner who did not enter", async function () {
      const { pot, settler, a, stranger, day0 } = await loadFixture(threeEntered);
      await goTo(day0 + 1n);
      await expect(pot.connect(settler).settle(day0, [a.address, stranger.address]))
        .to.be.revertedWithCustomError(pot, "NotAnEntrant")
        .withArgs(stranger.address);
      await expect(pot.connect(settler).settle(day0, [settler.address])).to.be.revertedWithCustomError(pot, "NotAnEntrant");
      await expect(pot.connect(settler).settle(day0, [ethers.ZeroAddress])).to.be.revertedWithCustomError(pot, "NotAnEntrant");
    });

    it("refuses someone who entered a different day", async function () {
      const { pot, settler, a, e, day0 } = await loadFixture(threeEntered);
      await goTo(day0 + 1n);
      await pot.connect(e).enter(day0 + 1n, MIN);
      await expect(pot.connect(settler).settle(day0, [e.address])).to.be.revertedWithCustomError(pot, "NotAnEntrant");
    });

    it("refuses duplicate winners", async function () {
      const { pot, settler, a, b, day0 } = await loadFixture(threeEntered);
      await goTo(day0 + 1n);
      await expect(pot.connect(settler).settle(day0, [a.address, a.address])).to.be.revertedWithCustomError(pot, "DuplicateWinner");
      await expect(pot.connect(settler).settle(day0, [a.address, b.address, a.address])).to.be.revertedWithCustomError(pot, "DuplicateWinner");
    });

    it("refuses more than three winners", async function () {
      const { pot, settler, a, b, c, d, day0 } = await loadFixture(threeEntered);
      await goTo(day0 + 1n);
      await expect(pot.connect(settler).settle(day0, [a.address, b.address, c.address, d.address])).to.be.revertedWithCustomError(pot, "TooManyWinners");
    });

    it("is one time only", async function () {
      const { pot, settler, a, b, day0 } = await loadFixture(threeEntered);
      await goTo(day0 + 1n);
      await pot.connect(settler).settle(day0, [a.address]);
      await expect(pot.connect(settler).settle(day0, [b.address])).to.be.revertedWithCustomError(pot, "AlreadySettled");
      await expect(pot.connect(settler).settle(day0, [])).to.be.revertedWithCustomError(pot, "AlreadySettled");
    });

    it("a new settler cannot redo a settled day either", async function () {
      const { pot, owner, settler, stranger, a, b, day0 } = await loadFixture(threeEntered);
      await goTo(day0 + 1n);
      await pot.connect(settler).settle(day0, [a.address]);
      await pot.connect(owner).setSettler(stranger.address);
      await expect(pot.connect(stranger).settle(day0, [b.address])).to.be.revertedWithCustomError(pot, "AlreadySettled");
    });

    it("still works on the last second of the 7 day window and not after", async function () {
      const { pot, settler, a, day0 } = await loadFixture(threeEntered);
      const deadline = (day0 + 1n) * DAY + 7n * DAY;
      await time.setNextBlockTimestamp(deadline - 1n);
      await pot.connect(settler).settle(day0, [a.address]);

      const f = await deploy();
      await f.pot.connect(f.a).enter(f.day0, MIN);
      const dl = (f.day0 + 1n) * DAY + 7n * DAY;
      await time.setNextBlockTimestamp(dl);
      await expect(f.pot.connect(f.settler).settle(f.day0, [f.a.address])).to.be.revertedWithCustomError(f.pot, "SettleWindowClosed");
    });
  });

  describe("claim", function () {
    it("pays the winner and cannot be claimed twice", async function () {
      const { pot, token, settler, a, b, day0 } = await loadFixture(deploy);
      await pot.connect(a).enter(day0, MIN);
      await pot.connect(b).enter(day0, MIN);
      await goTo(day0 + 1n);
      await pot.connect(settler).settle(day0, [a.address, b.address]);
      await expect(pot.connect(a).claim()).to.changeTokenBalances(token, [a, pot], [E(140), -E(140)]);
      expect(await pot.claimable(a.address)).to.equal(0);
      await expect(pot.connect(a).claim()).to.be.revertedWithCustomError(pot, "NothingToClaim");
    });

    it("a non-winner has nothing to claim", async function () {
      const { pot, stranger } = await loadFixture(deploy);
      await expect(pot.connect(stranger).claim()).to.be.revertedWithCustomError(pot, "NothingToClaim");
    });

    it("adds up wins across several days into one claim", async function () {
      const { pot, token, settler, a, b, day0 } = await loadFixture(deploy);
      await pot.connect(a).enter(day0, MIN);
      await goTo(day0 + 1n);
      await pot.connect(a).enter(day0 + 1n, MIN);
      await pot.connect(b).enter(day0 + 1n, MIN);
      await pot.connect(settler).settle(day0, [a.address]);
      await goTo(day0 + 2n);
      await pot.connect(settler).settle(day0 + 1n, [a.address, b.address]);
      expect(await pot.claimable(a.address)).to.equal(MIN + E(140));
      await expect(pot.connect(a).claim()).to.changeTokenBalance(token, a, MIN + E(140));
    });
  });

  describe("rollover", function () {
    it("zero winners rolls the pot into today", async function () {
      const { pot, settler, a, b, day0 } = await loadFixture(deploy);
      await pot.connect(a).enter(day0, MIN);
      await pot.connect(b).enter(day0, MIN);
      await goTo(day0 + 1n);
      await expect(pot.connect(settler).settle(day0, []))
        .to.emit(pot, "RolledOver")
        .withArgs(day0, day0 + 1n, E(200));
      expect(await pot.isSettled(day0)).to.equal(true);
      expect(await pot.potSize(day0 + 1n)).to.equal(E(200));
      expect(await pot.claimable(a.address)).to.equal(0);
    });

    it("chains through several empty days and pays the first real winner everything", async function () {
      const { pot, token, settler, a, b, c, day0 } = await loadFixture(deploy);
      await pot.connect(a).enter(day0, MIN);
      await pot.connect(b).enter(day0, MIN);
      await goTo(day0 + 1n);
      await pot.connect(settler).settle(day0, []); // 200 into day0+1, which nobody enters
      await goTo(day0 + 2n);
      await pot.connect(settler).settle(day0 + 1n, []); // 200 into day0+2, nobody enters
      await goTo(day0 + 3n);
      await pot.connect(settler).settle(day0 + 2n, []); // 200 into day0+3
      await pot.connect(c).enter(day0 + 3n, MIN);
      expect(await pot.potSize(day0 + 3n)).to.equal(E(300));
      await goTo(day0 + 4n);
      await pot.connect(settler).settle(day0 + 3n, [c.address]);
      await expect(pot.connect(c).claim()).to.changeTokenBalance(token, c, E(300));
      expect(await token.balanceOf(await pot.getAddress())).to.equal(0);
    });

    it("a late settlement rolls into the day it is sent on, which is still open", async function () {
      const { pot, settler, a, day0 } = await loadFixture(deploy);
      await pot.connect(a).enter(day0, MIN);
      await goTo(day0 + 4n);
      await expect(pot.connect(settler).settle(day0, [])).to.emit(pot, "RolledOver").withArgs(day0, day0 + 4n, MIN);
      expect(await pot.potSize(day0 + 1n)).to.equal(0);
      expect(await pot.potSize(day0 + 4n)).to.equal(MIN);
    });

    it("settling an empty day with nothing in it just closes it", async function () {
      const { pot, settler, day0 } = await loadFixture(deploy);
      await goTo(day0 + 1n);
      await expect(pot.connect(settler).settle(day0, [])).to.not.emit(pot, "RolledOver");
      expect(await pot.isSettled(day0)).to.equal(true);
    });
  });

  describe("refund safety net", function () {
    it("is not allowed before 7 full days after the day ends", async function () {
      const { pot, a, day0 } = await loadFixture(deploy);
      await pot.connect(a).enter(day0, MIN);
      await expect(pot.refund(day0)).to.be.revertedWithCustomError(pot, "RefundNotAllowedYet");
      await time.setNextBlockTimestamp((day0 + 8n) * DAY - 1n);
      await expect(pot.refund(day0)).to.be.revertedWithCustomError(pot, "RefundNotAllowedYet");
      await time.setNextBlockTimestamp((day0 + 8n) * DAY);
      await expect(pot.refund(day0)).to.emit(pot, "RefundOpened").withArgs(day0);
    });

    it("anyone opens it, every entrant pulls their own entry, once", async function () {
      const { pot, token, a, b, stranger, day0 } = await loadFixture(deploy);
      await pot.connect(a).enter(day0, MIN);
      await pot.connect(b).enter(day0, E(300));
      await goTo(day0 + 8n);
      await pot.connect(stranger).refund(day0);
      expect(await pot.isRefundOpen(day0)).to.equal(true);
      await expect(pot.connect(a).claimRefund(day0)).to.changeTokenBalance(token, a, MIN);
      await expect(pot.connect(b).claimRefund(day0)).to.emit(pot, "Refunded").withArgs(day0, b.address, E(300));
      await expect(pot.connect(a).claimRefund(day0)).to.be.revertedWithCustomError(pot, "AlreadyRefunded");
      await expect(pot.connect(stranger).claimRefund(day0)).to.be.revertedWithCustomError(pot, "NotAnEntrant");
      expect(await pot.refundTaken(day0, a.address)).to.equal(true);
      expect(await token.balanceOf(await pot.getAddress())).to.equal(0);
    });

    it("after the window, the settler can no longer settle and refund wins", async function () {
      const { pot, settler, a, day0 } = await loadFixture(deploy);
      await pot.connect(a).enter(day0, MIN);
      await goTo(day0 + 8n);
      await expect(pot.connect(settler).settle(day0, [a.address])).to.be.revertedWithCustomError(pot, "SettleWindowClosed");
      await pot.refund(day0);
      await expect(pot.connect(settler).settle(day0, [a.address])).to.be.revertedWithCustomError(pot, "SettleWindowClosed");
      await pot.connect(a).claimRefund(day0);
    });

    it("cannot refund a settled day, cannot open twice, cannot open an empty day", async function () {
      const { pot, settler, a, day0 } = await loadFixture(deploy);
      await pot.connect(a).enter(day0, MIN);
      await goTo(day0 + 1n);
      await pot.connect(settler).settle(day0, [a.address]);
      await goTo(day0 + 9n);
      await expect(pot.refund(day0)).to.be.revertedWithCustomError(pot, "AlreadySettled");
      await expect(pot.refund(day0 + 1n)).to.be.revertedWithCustomError(pot, "NothingToRefund");

      await pot.connect(a).enter(day0 + 9n, MIN);
      await goTo(day0 + 17n);
      await pot.refund(day0 + 9n);
      await expect(pot.refund(day0 + 9n)).to.be.revertedWithCustomError(pot, "RefundIsOpen");
    });

    it("claimRefund needs the refund to be open", async function () {
      const { pot, a, day0 } = await loadFixture(deploy);
      await pot.connect(a).enter(day0, MIN);
      await goTo(day0 + 3n);
      await expect(pot.connect(a).claimRefund(day0)).to.be.revertedWithCustomError(pot, "RefundNotOpen");
    });

    it("money that had rolled into a refunded day moves on to today, not stuck", async function () {
      const { pot, token, settler, a, b, c, day0 } = await loadFixture(deploy);
      await pot.connect(a).enter(day0, MIN);
      await goTo(day0 + 1n);
      await pot.connect(settler).settle(day0, []); // 100 rolls into day0+1
      await pot.connect(b).enter(day0 + 1n, MIN); // day0+1 now 200, settler then goes quiet
      await goTo(day0 + 9n);
      await expect(pot.refund(day0 + 1n)).to.emit(pot, "RolledOver").withArgs(day0 + 1n, day0 + 9n, MIN);
      await expect(pot.connect(b).claimRefund(day0 + 1n)).to.changeTokenBalance(token, b, MIN);
      await pot.connect(c).enter(day0 + 9n, MIN);
      await goTo(day0 + 10n);
      await pot.connect(settler).settle(day0 + 9n, [c.address]);
      await expect(pot.connect(c).claim()).to.changeTokenBalance(token, c, E(200));
      expect(await token.balanceOf(await pot.getAddress())).to.equal(0);
    });
  });

  describe("minimum entry", function () {
    it("a change never touches the day already open, only the next day", async function () {
      const { pot, owner, a, b, c, day0 } = await loadFixture(deploy);
      await pot.connect(a).enter(day0, MIN);
      await expect(pot.connect(owner).setMinEntry(E(500))).to.emit(pot, "MinEntryScheduled").withArgs(E(500), day0 + 1n);
      expect(await pot.minEntry()).to.equal(MIN);
      expect(await pot.minEntryFor(day0 + 1n)).to.equal(E(500));
      await pot.connect(b).enter(day0, MIN); // still the old minimum today
      await goTo(day0 + 1n);
      expect(await pot.minEntry()).to.equal(E(500));
      await expect(pot.connect(c).enter(day0 + 1n, MIN)).to.be.revertedWithCustomError(pot, "BelowMinEntry");
      await pot.connect(c).enter(day0 + 1n, E(500));
    });

    it("a lower minimum also waits for the next day", async function () {
      const { pot, owner, a, day0 } = await loadFixture(deploy);
      await pot.connect(owner).setMinEntry(E(1));
      await expect(pot.connect(a).enter(day0, E(1))).to.be.revertedWithCustomError(pot, "BelowMinEntry");
    });

    it("two changes on the same day: the last one wins tomorrow, today unchanged", async function () {
      const { pot, owner, day0 } = await loadFixture(deploy);
      await pot.connect(owner).setMinEntry(E(500));
      await pot.connect(owner).setMinEntry(E(700));
      expect(await pot.minEntry()).to.equal(MIN);
      expect(await pot.minEntryFor(day0 + 1n)).to.equal(E(700));
    });

    it("a change after an earlier one took effect keeps today at the earlier value", async function () {
      const { pot, owner, a, day0 } = await loadFixture(deploy);
      await pot.connect(owner).setMinEntry(E(500));
      await goTo(day0 + 3n);
      await pot.connect(owner).setMinEntry(E(50));
      expect(await pot.minEntry()).to.equal(E(500));
      await expect(pot.connect(a).enter(day0 + 3n, E(50))).to.be.revertedWithCustomError(pot, "BelowMinEntry");
      await goTo(day0 + 4n);
      expect(await pot.minEntry()).to.equal(E(50));
    });

    it("only the owner, never zero", async function () {
      const { pot, owner, stranger } = await loadFixture(deploy);
      await expect(pot.connect(stranger).setMinEntry(1)).to.be.revertedWithCustomError(pot, "OwnableUnauthorizedAccount");
      await expect(pot.connect(owner).setMinEntry(0)).to.be.revertedWithCustomError(pot, "ZeroAmount");
    });
  });

  describe("owner", function () {
    it("only the owner sets the settler, never to zero", async function () {
      const { pot, owner, stranger } = await loadFixture(deploy);
      await expect(pot.connect(stranger).setSettler(stranger.address)).to.be.revertedWithCustomError(pot, "OwnableUnauthorizedAccount");
      await expect(pot.connect(owner).setSettler(ethers.ZeroAddress)).to.be.revertedWithCustomError(pot, "ZeroAddress");
      await expect(pot.connect(owner).setSettler(stranger.address)).to.emit(pot, "SettlerChanged");
      expect(await pot.settler()).to.equal(stranger.address);
    });

    it("ownership can never be renounced", async function () {
      const { pot, owner } = await loadFixture(deploy);
      await expect(pot.connect(owner).renounceOwnership()).to.be.revertedWithCustomError(pot, "RenounceDisabled");
      expect(await pot.owner()).to.equal(owner.address);
    });

    it("hands over ownership in two steps", async function () {
      const { pot, owner, stranger } = await loadFixture(deploy);
      await pot.connect(owner).transferOwnership(stranger.address);
      expect(await pot.owner()).to.equal(owner.address);
      await pot.connect(stranger).acceptOwnership();
      expect(await pot.owner()).to.equal(stranger.address);
    });
  });

  describe("reentrancy", function () {
    async function withReentrantToken() {
      const [owner, settler, a, b] = await ethers.getSigners();
      const token = await (await ethers.getContractFactory("ReentrantToken")).deploy();
      const pot = await (await ethers.getContractFactory("ChogPot")).deploy(await token.getAddress(), settler.address, MIN);
      for (const p of [a, b]) {
        await token.mint(p.address, E(1000));
        await token.connect(p).approve(await pot.getAddress(), ethers.MaxUint256);
      }
      const day0 = (BigInt(await time.latest()) / DAY) + 2n;
      await goTo(day0);
      return { token, pot, owner, settler, a, b, day0 };
    }

    it("a token calling back into claim during a payout is blocked", async function () {
      const { token, pot, settler, a, b, day0 } = await loadFixture(withReentrantToken);
      await pot.connect(a).enter(day0, MIN);
      await pot.connect(b).enter(day0, MIN);
      await goTo(day0 + 1n);
      await pot.connect(settler).settle(day0, [a.address, b.address]);
      await token.arm(await pot.getAddress(), pot.interface.encodeFunctionData("claim"));
      await expect(pot.connect(a).claim()).to.be.revertedWithCustomError(pot, "ReentrancyGuardReentrantCall");
      expect(await pot.claimable(a.address)).to.equal(E(140)); // nothing lost, nothing paid twice
    });

    it("a token calling back into claimRefund during a refund is blocked", async function () {
      const { token, pot, a, day0 } = await loadFixture(withReentrantToken);
      await pot.connect(a).enter(day0, MIN);
      await goTo(day0 + 8n);
      await pot.refund(day0);
      await token.arm(await pot.getAddress(), pot.interface.encodeFunctionData("claimRefund", [day0]));
      await expect(pot.connect(a).claimRefund(day0)).to.be.revertedWithCustomError(pot, "ReentrancyGuardReentrantCall");
      expect(await pot.refundTaken(day0, a.address)).to.equal(false);
    });
  });

  describe("claim order", function () {
    it("the claimable balance is already zero when the payout is sent", async function () {
      const [, settler, a, b] = await ethers.getSigners();
      const token = await (await ethers.getContractFactory("ObserverToken")).deploy();
      const pot = await (await ethers.getContractFactory("ChogPot")).deploy(await token.getAddress(), settler.address, MIN);
      for (const p of [a, b]) {
        await token.mint(p.address, E(1000));
        await token.connect(p).approve(await pot.getAddress(), ethers.MaxUint256);
      }
      const day0 = (BigInt(await time.latest()) / DAY) + 2n;
      await goTo(day0);
      await pot.connect(a).enter(day0, MIN);
      await pot.connect(b).enter(day0, MIN);
      await goTo(day0 + 1n);
      await pot.connect(settler).settle(day0, [a.address, b.address]);
      expect(await pot.claimable(a.address)).to.equal(E(140));
      await token.watch(await pot.getAddress());
      await pot.connect(a).claim();
      expect(await token.observed()).to.equal(true);
      expect(await token.seen()).to.equal(0n);
    });
  });

  describe("money always adds up", function () {
    // A seeded random run over many days. After every step the contract must hold exactly
    // what it owes: unclaimed wins + unrefunded entries on refund days + every open pot.
    it("holds exactly what it owes after a long random run", async function () {
      const { pot, token, settler, a, b, c, d, e, day0 } = await loadFixture(deploy);
      const players = [a, b, c, d, e];
      let seed = 12345;
      const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return Math.floor(seed / 65536) % n; };
      const touched = new Set(); // days with any activity
      const seen = { paid: 0, rolled: 0, refunded: 0 };
      const potAddr = await pot.getAddress();

      async function owed() {
        let sum = 0n;
        for (const p of players) sum += await pot.claimable(p.address);
        for (const day of touched) {
          const [entries, carriedIn, , settled, refundOpen] = await pot.dayInfo(day);
          if (refundOpen) {
            for (const p of players) {
              if ((await pot.hasEntered(day, p.address)) && !(await pot.refundTaken(day, p.address))) sum += await pot.entryOf(day, p.address);
            }
          } else if (!settled) {
            sum += entries + carriedIn;
          }
        }
        return sum;
      }

      for (let k = 0n; k < 20n; k++) {
        const day = day0 + k;
        await goTo(day, 7200n);
        touched.add(day);
        for (const p of players) if (rnd(2)) await pot.connect(p).enter(day, MIN + BigInt(rnd(1000)));
        // settle yesterday with 0 to 3 winners, or sometimes leave it for the refund path
        const prev = day - 1n;
        if (k > 0n && rnd(4) !== 0) {
          const entrants = [];
          for (const p of players) if (await pot.hasEntered(prev, p.address)) entrants.push(p.address);
          const n = Math.min(entrants.length, rnd(4));
          await pot.connect(settler).settle(prev, entrants.slice(0, n));
          seen[n === 0 ? "rolled" : "paid"]++;
        }
        // open refunds on anything old enough and unsettled
        for (const old of touched) {
          if (old + 8n <= day && !(await pot.isSettled(old)) && !(await pot.isRefundOpen(old))) {
            const [en, ci] = await pot.dayInfo(old);
            if (en + ci > 0n) { await pot.refund(old); seen.refunded++; }
          }
        }
        // some players pull what they are owed
        for (const p of players) {
          if (rnd(3) === 0 && (await pot.claimable(p.address)) > 0n) await pot.connect(p).claim();
          for (const old of touched) {
            if ((await pot.isRefundOpen(old)) && (await pot.hasEntered(old, p.address)) && !(await pot.refundTaken(old, p.address)) && rnd(2))
              await pot.connect(p).claimRefund(old);
          }
        }
        expect(await token.balanceOf(potAddr)).to.equal(await owed());
      }
      // Make sure the run really went down every path, not just the easy one.
      expect(seen.paid).to.be.greaterThan(0);
      expect(seen.rolled).to.be.greaterThan(0);
      expect(seen.refunded).to.be.greaterThan(0);
    });
  });

  describe("website ABI", function () {
    it("lib/potAbi.ts matches the compiled contract", async function () {
      const artifact = require("../artifacts/src/ChogPot.sol/ChogPot.json");
      const src = fs.readFileSync(path.join(__dirname, "..", "..", "lib", "potAbi.ts"), "utf8");
      const json = src.slice(src.indexOf("["), src.lastIndexOf("]") + 1);
      expect(JSON.parse(json)).to.deep.equal(artifact.abi);
    });
  });
});
