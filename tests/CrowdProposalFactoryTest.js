const {
  uint,
  address,
  encodeParameters,
  mergeInterface,
} = require("./Helpers");

describe("CrowdProposalFactory", () => {
  let uni, gov, root, a1, accounts;
  let factory;

  const minUniThreshold = 100e18;

  beforeEach(async () => {
    [root, timelock, a1, ...accounts] = saddle.accounts;
    uni = await deploy("Uni", [root]);
    govDelegate = await deploy("GovernorBravoDelegateHarness");
    gov = await deploy("GovernorBravoDelegator", [
      address(0),
      uni._address,
      root,
      govDelegate._address,
      17280,
      1,
      "100000000000000000000000",
    ]);
    mergeInterface(gov, govDelegate);
    await send(gov, "_initiate");
    factory = await deploy("CrowdProposalFactory", [
      uni._address,
      gov._address,
      timelock,
      uint(minUniThreshold),
    ]);
  });

  describe("metadata", () => {
    it("has given uni", async () => {
      expect(await call(factory, "uni")).toEqual(uni._address);
    });

    it("has given governor", async () => {
      expect(await call(factory, "governor")).toEqual(gov._address);
    });

    it("has given min uni threshold", async () => {
      expect(await call(factory, "uniStakeAmount")).toEqual(
        "100000000000000000000"
      );
    });
  });

  describe("setUniStakeAmount", () => {
    it("revert if sender does not timelock", async () => {
      await expect(
        send(factory, "setUniStakeAmount", [999], { from: root })
      ).rejects.toRevert("revert only timelock");
    });

    it("successfully change stake amount", async () => {
      await send(factory, "setUniStakeAmount", [999], {
        from: timelock,
      });
      expect(await call(factory, "uniStakeAmount", [])).toEqual("999");
    });
  });

  describe("createCrowdProposal", () => {
    it("successfully creates crowd proposal", async () => {
      const author = accounts[0];

      // Fund author account
      await send(uni, "transfer", [author, uint(minUniThreshold)], {
        from: root,
      });
      expect(await call(uni, "balanceOf", [author])).toEqual(
        minUniThreshold.toString()
      );

      // Approve factory to stake union tokens for proposal
      await send(uni, "approve", [factory._address, uint(minUniThreshold)], {
        from: author,
      });

      // Proposal data
      const targets = [root];
      const values = ["0"];
      const signatures = ["getBalanceOf(address)"];
      const callDatas = [encodeParameters(["address"], [a1])];
      const description = "do nothing";

      const trx = await send(
        factory,
        "createCrowdProposal",
        [targets, values, signatures, callDatas, description],
        { from: author }
      );

      // Check balance of proposal and delegated votes
      const proposalEvent = trx.events["CrowdProposalCreated"];
      expect(proposalEvent.returnValues.author).toEqual(author);
      const newProposal = proposalEvent.returnValues.proposal;
      expect(await call(uni, "balanceOf", [newProposal])).toEqual(
        minUniThreshold.toString()
      );
      expect(await call(uni, "balanceOf", [author])).toEqual("0");
      expect(await call(uni, "getCurrentVotes", [newProposal])).toEqual(
        minUniThreshold.toString()
      );
    });

    it("revert if author does not have enough Uni", async () => {
      let author = accounts[0];

      // Fund author account
      const uniBalance = 99e18;
      await send(uni, "transfer", [author, uint(uniBalance)], { from: root });
      expect(await call(uni, "balanceOf", [author])).toEqual(
        uniBalance.toString()
      );

      // Approve factory to stake union tokens for proposal
      await send(uni, "approve", [factory._address, uint(uniBalance)], {
        from: author,
      });

      // Proposal data
      const targets = [root];
      const values = ["0"];
      const signatures = ["getBalanceOf(address)"];
      const callDatas = [encodeParameters(["address"], [a1])];
      const description = "do nothing";

      await expect(
        send(
          factory,
          "createCrowdProposal",
          [targets, values, signatures, callDatas, description],
          { from: author }
        )
      ).rejects.toRevert(
        "revert Uni::transferFrom: transfer amount exceeds spender allowance"
      );
    });
  });
});
