const {
  uint,
  address,
  encodeParameters,
  sendRPC,
  mergeInterface,
} = require("./Helpers");
const BigNumber = require("bignumber.js");

const states = {
  Pending: "0",
  Active: "1",
  Canceled: "2",
  Defeated: "3",
  Succeeded: "4",
  Queued: "5",
  Expired: "6",
  Executed: "7",
};

describe("CrowdProposal", () => {
  let uni, gov, root, a1, accounts;
  let author, proposal;

  let targets, values, signatures, callDatas, description;

  const minUniThreshold = 100e18;
  const minUni = new BigNumber(minUniThreshold).toFixed();

  beforeEach(async () => {
    [root, a1, ...accounts] = saddle.accounts;
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

    author = accounts[0];

    // Proposal data
    targets = [root];
    values = ["0"];
    signatures = ["getBalanceOf(address)"];
    callDatas = [encodeParameters(["address"], [a1])];
    description = "do nothing";

    // Create proposal, mimic factory behavior
    proposal = await deploy("CrowdProposal", [
      author,
      targets,
      values,
      signatures,
      callDatas,
      description,
      uni._address,
      gov._address,
    ]);
    // 1. Stake uni
    await send(uni, "transfer", [proposal._address, uint(minUniThreshold)], {
      from: root,
    });
  });

  describe("metadata", () => {
    it("has govProposalId set to 0", async () => {
      expect(await call(proposal, "govProposalId")).toEqual("0");
    });

    it("has given author", async () => {
      expect(await call(proposal, "author")).toEqual(author);
    });

    it("has given uni", async () => {
      expect(await call(proposal, "union")).toEqual(uni._address);
    });

    it("has given governor", async () => {
      expect(await call(proposal, "governor")).toEqual(gov._address);
    });

    it("has given targets", async () => {
      expect(await call(proposal, "targets", [0])).toEqual(targets[0]);
    });

    it("has given values", async () => {
      expect(await call(proposal, "values", [0])).toEqual(values[0]);
    });

    it("has given signatures", async () => {
      expect(await call(proposal, "signatures", [0])).toEqual(signatures[0]);
    });

    it("has given calldatas", async () => {
      expect(await call(proposal, "calldatas", [0])).toEqual(callDatas[0]);
    });

    it("has given description", async () => {
      expect(await call(proposal, "description")).toEqual(description);
    });
  });

  describe("propose", () => {
    it("should pass if enough votes were delegated", async () => {
      // Check start balance of votes
      expect(await call(uni, "balanceOf", [proposal._address])).toEqual(minUni);
      expect(await call(uni, "getCurrentVotes", [proposal._address])).toEqual(
        minUni
      );

      // Check that gov proposal has not beem proposed yet
      expect(await call(proposal, "govProposalId")).toEqual("0");

      // Delegate all votes to proposal
      await send(uni, "delegate", [proposal._address], { from: root });

      // Propose
      const trx = await send(proposal, "propose", { from: root });

      // Check trx data
      const proposalEvent = trx.events["CrowdProposalProposed"];
      expect(proposalEvent.returnValues.author).toEqual(author);
      expect(proposalEvent.returnValues.proposal).toEqual(proposal._address);
      const govProposalId = proposalEvent.returnValues.proposalId;
      expect(await call(proposal, "govProposalId")).toEqual(govProposalId);

      // Check state of governance proposal
      const proposalData = await call(gov, "proposals", [govProposalId]);
      expect(proposalData.againstVotes).toBe("0");
      expect(proposalData.forVotes).toBe("0");
      expect(await call(gov, "state", [govProposalId], {})).toEqual(
        states["Pending"]
      );

      await sendRPC(web3, "evm_mine", []);
      await sendRPC(web3, "evm_mine", []);

      expect(await call(gov, "state", [govProposalId], {})).toEqual(
        states["Active"]
      );
    });

    it("should revert if gov proposal already exists", async () => {
      // Delegate all votes to proposal
      await send(uni, "delegate", [proposal._address], { from: root });

      // Propose successful
      await send(proposal, "propose", { from: root });
      expect(parseInt(await call(proposal, "govProposalId"))).toBeGreaterThan(
        0
      );

      // Propose reverts
      await expect(send(proposal, "propose", { from: root })).rejects.toRevert(
        "revert CrowdProposal::propose: gov proposal already exists"
      );
    });

    it("should revert if not enough votes were delegated", async () => {
      // Propose reverts, not enough votes were delegated
      await expect(send(proposal, "propose", { from: root })).rejects.toRevert(
        "revert GovernorBravo::propose: proposer votes below proposal threshold"
      );

      expect(await call(proposal, "govProposalId")).toEqual("0");
    });

    it("should revert if proposal was terminated", async () => {
      await send(proposal, "terminate", { from: author });

      // Staked uni is transfered back to author
      expect(await call(uni, "balanceOf", [author])).toEqual(minUni);

      await expect(send(proposal, "propose", { from: root })).rejects.toRevert(
        "revert CrowdProposal::propose: proposal has been terminated"
      );
    });
  });

  describe("terminate", () => {
    it("should terminate after gov proposal was created", async () => {
      // Delegate all votes to proposal
      await send(uni, "delegate", [proposal._address], { from: root });

      // Propose
      await send(proposal, "propose", { from: root });
      const govProposalId = await call(proposal, "govProposalId");

      await sendRPC(web3, "evm_mine", []);

      // Vote for the gov proposal
      await send(proposal, "vote", { from: author });

      // Check terminated flag
      expect(await call(proposal, "terminated")).toEqual(false);

      // Terminate crowd proposal
      const trx = await send(proposal, "terminate", { from: author });
      const terminateEvent = trx.events["CrowdProposalTerminated"];
      expect(terminateEvent.returnValues.author).toEqual(author);
      expect(terminateEvent.returnValues.proposal).toEqual(proposal._address);

      // Check terminated flag
      expect(await call(proposal, "terminated")).toEqual(true);

      // Staked uni is transfered back to author
      expect(await call(uni, "balanceOf", [author])).toEqual(
        minUniThreshold.toString()
      );

      // Check state and governance proposal votes
      expect(await call(gov, "state", [govProposalId])).toEqual(
        states["Active"]
      );
      const proposalData = await call(gov, "proposals", [govProposalId]);
      expect(proposalData.againstVotes).toBe("0");
      expect(proposalData.forVotes).toBe(await call(uni, "totalSupply"));
    });

    it("should terminate without transfering votes", async () => {
      // Delegate all votes to proposal
      await send(uni, "delegate", [proposal._address], { from: root });

      // Propose
      await send(proposal, "propose", { from: root });
      const govProposalId = await call(proposal, "govProposalId");

      // Terminate crowd proposal
      await send(proposal, "terminate", { from: author });

      // Staked uni is transfered back to author
      expect(await call(uni, "balanceOf", [author])).toEqual(
        minUniThreshold.toString()
      );

      // Check state and governance proposal votes
      expect(await call(gov, "state", [govProposalId])).toEqual(
        states["Pending"]
      );
      const proposalData = await call(gov, "proposals", [govProposalId]);
      expect(proposalData.againstVotes).toBe("0");
      expect(proposalData.forVotes).toBe("0");
    });

    it("should terminate without proposing, not enough votes were delegated", async () => {
      expect(await call(proposal, "govProposalId")).toEqual("0");
      // Terminate crowd proposal
      await send(proposal, "terminate", { from: author });

      // Staked uni is transfered back to author
      expect(await call(uni, "balanceOf", [author])).toEqual(
        minUniThreshold.toString()
      );
    });

    it("should terminate without proposing, even with enough delegated votes", async () => {
      // Delegate all votes to proposal
      await send(uni, "delegate", [proposal._address], { from: root });

      expect(await call(proposal, "govProposalId")).toEqual("0");
      // Terminate crowd proposal
      await send(proposal, "terminate", { from: author });

      // Staked uni is transfered back to author
      expect(await call(uni, "balanceOf", [author])).toEqual(
        minUniThreshold.toString()
      );
    });

    it("should revert if called not by author", async () => {
      // Terminate reverts
      await expect(
        send(proposal, "terminate", { from: root })
      ).rejects.toRevert(
        "revert CrowdProposal::terminate: only author can terminate"
      );
    });

    it("should revert if already terminated", async () => {
      // Terminate crowd proposal
      await send(proposal, "terminate", { from: author });

      // Terminate reverts
      await expect(
        send(proposal, "terminate", { from: author })
      ).rejects.toRevert(
        "revert CrowdProposal::terminate: proposal has been already terminated"
      );
    });
  });

  describe("vote", () => {
    it("should successfully vote for proposal", async () => {
      // Propose
      await send(uni, "delegate", [proposal._address], { from: root });
      await send(proposal, "propose", { from: root });
      const govProposalId = await call(proposal, "govProposalId");

      await sendRPC(web3, "evm_mine", []);

      // Vote, check event and number of votes
      const trx = await send(proposal, "vote", { from: root });
      const voteEvent = trx.events["CrowdProposalVoted"];
      expect(voteEvent.returnValues.proposalId).toEqual(govProposalId);
      expect(voteEvent.returnValues.proposal).toEqual(proposal._address);

      const proposalData = await call(gov, "proposals", [govProposalId]);
      expect(proposalData.againstVotes).toBe("0");
      expect(proposalData.forVotes).toBe(await call(uni, "totalSupply"));
    });

    it("should be able to vote even after proposal was terminated", async () => {
      // Propose
      await send(uni, "delegate", [proposal._address], { from: root });
      await send(proposal, "propose", { from: root });
      const govProposalId = await call(proposal, "govProposalId");

      await send(proposal, "terminate", { from: author });

      // Vote and check number of votes
      await send(proposal, "vote", { from: root });
      const proposalData = await call(gov, "proposals", [govProposalId]);

      // uni stake is withdrawn by an author, so total number of votes for will be less
      const leftVotes = new BigNumber(await call(uni, "totalSupply"))
        .minus(minUni)
        .toFixed();
      expect(proposalData.againstVotes).toBe("0");
      expect(proposalData.forVotes).toBe(leftVotes);
    });

    it("should revert if gov proposal is not created yet", async () => {
      // An attempt to vote
      await expect(send(proposal, "vote", { from: root })).rejects.toRevert(
        "revert CrowdProposal::vote: gov proposal has not been created yet"
      );
    });

    it("should revert if gov proposal is not in Active", async () => {
      // Propose
      await send(uni, "delegate", [proposal._address], { from: root });
      await send(proposal, "propose", { from: root });
      const govProposalId = await call(proposal, "govProposalId");

      expect(await call(gov, "state", [govProposalId], {})).toEqual(
        states["Pending"]
      );

      // Vote
      await expect(send(proposal, "vote", { from: root })).rejects.toRevert(
        "revert GovernorBravo::castVoteInternal: voting is closed"
      );
    });

    it("should revert if already voted", async () => {
      // Propose
      await send(uni, "delegate", [proposal._address], { from: root });
      await send(proposal, "propose", { from: root });
      const govProposalId = await call(proposal, "govProposalId");

      await sendRPC(web3, "evm_mine", []);

      // Vote
      await send(proposal, "vote", { from: root });

      await expect(send(proposal, "vote", { from: root })).rejects.toRevert(
        "revert GovernorBravo::castVoteInternal: voter already voted"
      );
    });
  });

  describe("full workflows", () => {
    it("CrowdProposal is successful", async () => {
      // Delegate more votes to the proposal
      const uniWhale = accounts[1];
      const proposalThreshold = await call(gov, "proposalThreshold");
      const currentVotes = await call(uni, "getCurrentVotes", [
        proposal._address,
      ]);
      const quorum = new BigNumber(proposalThreshold).plus(1);
      const remainingVotes = quorum.minus(new BigNumber(currentVotes));

      // Create Union mini whale
      await send(uni, "transfer", [uniWhale, uint(remainingVotes.toFixed())], {
        from: root,
      });
      // Whale delegates just enough to push proposal through
      await send(uni, "delegate", [proposal._address], { from: uniWhale });

      // Proposal meets threshold requirement
      expect(await call(uni, "getCurrentVotes", [proposal._address])).toEqual(
        quorum.toFixed()
      );

      // Launch governance proposal
      await send(proposal, "propose", { from: root });
      const govProposalId = await call(proposal, "govProposalId");

      await sendRPC(web3, "evm_mine", []);

      // Vote for the gov proposal
      await send(proposal, "vote", { from: root });

      expect(await call(uni, "balanceOf", [author])).toEqual("0");

      await send(proposal, "terminate", { from: author });

      // Staked union is transfered back to author
      expect(await call(uni, "balanceOf", [author])).toEqual(
        minUniThreshold.toString()
      );

      // Check votes for governance proposal
      const proposalData = await call(gov, "proposals", [govProposalId]);
      expect(proposalData.againstVotes).toBe("0");
      expect(proposalData.forVotes).toBe(quorum.toFixed());
    });

    it("CrowdProposal fails if not enough votes were delegated", async () => {
      // Delegate more votes to the crowd proposal
      const delegator1 = accounts[1];
      const delegator2 = accounts[2];

      const proposalThreshold = await call(gov, "proposalThreshold");
      const currentVotes = await call(uni, "getCurrentVotes", [
        proposal._address,
      ]);
      const quorum = new BigNumber(proposalThreshold).plus(1);
      const remainingVotes = quorum.minus(new BigNumber(currentVotes));

      // Proposal doesn't have enough votes to create governance proposal
      // Fund delegators with some union, but not enough for proposal to pass
      await send(
        uni,
        "transfer",
        [delegator1, uint(remainingVotes.dividedToIntegerBy(10).toFixed())],
        { from: root }
      );
      await send(
        uni,
        "transfer",
        [delegator2, uint(remainingVotes.dividedToIntegerBy(10).toFixed())],
        { from: root }
      );

      // Delegation period
      await send(uni, "delegate", [proposal._address], { from: delegator1 });
      await send(uni, "delegate", [proposal._address], { from: delegator2 });

      // An attempt to propose with not enough delegations
      await expect(send(proposal, "propose", { from: root })).rejects.toRevert(
        "revert GovernorBravo::propose: proposer votes below proposal threshold"
      );

      // Time passes ..., nobody delegates, proposal author gives up and wants their staked union back
      expect(await call(proposal, "govProposalId")).toEqual("0");
      await send(proposal, "terminate", { from: author });

      // Staked union is transfered back to author
      expect(await call(uni, "balanceOf", [author])).toEqual(
        minUniThreshold.toString()
      );
    });
  });
});
