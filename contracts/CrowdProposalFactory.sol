// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.6.10;
pragma experimental ABIEncoderV2;

import './IUnion.sol';
import './CrowdProposal.sol';

contract CrowdProposalFactory {
    /// @notice `uni` token contract address
    address public immutable uni;
    /// @notice Union protocol `UnionGovernor` contract address
    address public immutable governor;
    /// @notice Union protocol `UnionGovernor timelock` contract address
    address public immutable timelock;
    /// @notice Minimum Uni tokens required to create a crowd proposal
    uint public uniStakeAmount;

    /// @notice An event emitted when a crowd proposal is created
    event CrowdProposalCreated(address indexed proposal, address indexed author, address[] targets, uint[] values, string[] signatures, bytes[] calldatas, string description);

    event StakeAmountChange(uint oldAmount, uint newAmount);
     /**
     * @notice Construct a proposal factory for crowd proposals
     * @param uni_ `uni` token contract address
     * @param governor_ Union protocol `UnionGovernor` contract address
     * @param uniStakeAmount_ The minimum amount of uni tokes required for creation of a crowd proposal
     */
    constructor(address uni_,
                address governor_,
                address timelock_,
                uint uniStakeAmount_) public {
        uni = uni_;
        governor = governor_;
        timelock = timelock_;
        uniStakeAmount = uniStakeAmount_;
    }

    function setUniStakeAmount(uint uniStakeAmount_) external {
        require(msg.sender == timelock, "only timelock");
        uint oldUniStakeAmount = uniStakeAmount;
        uniStakeAmount = uniStakeAmount_;
        emit StakeAmountChange(oldUniStakeAmount, uniStakeAmount);
    }

    /**
    * @notice Create a new crowd proposal
    * @notice Call `Uni.approve(factory_address, uniStakeAmount)` before calling this method
    * @param targets The ordered list of target addresses for calls to be made
    * @param values The ordered list of values (i.e. msg.value) to be passed to the calls to be made
    * @param signatures The ordered list of function signatures to be called
    * @param calldatas The ordered list of calldata to be passed to each call
    * @param description The block at which voting begins: holders must delegate their votes prior to this block
    */
    function createCrowdProposal(address[] memory targets,
                                 uint[] memory values,
                                 string[] memory signatures,
                                 bytes[] memory calldatas,
                                 string memory description) external {
        CrowdProposal proposal = new CrowdProposal(msg.sender, targets, values, signatures, calldatas, description, uni, governor);
        emit CrowdProposalCreated(address(proposal), msg.sender, targets, values, signatures, calldatas, description);

        // Stake uni and force proposal to delegate votes to itself
        IUni(uni).transferFrom(msg.sender, address(proposal), uniStakeAmount);
    }
}