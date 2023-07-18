// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.6.10;
pragma experimental ABIEncoderV2;

import './IUnion.sol';
import './CrowdProposal.sol';

contract CrowdProposalFactory {
    /// @notice `UNION` token contract address
    address public immutable union;
    /// @notice Union protocol `UnionGovernor` contract address
    address public immutable governor;
    /// @notice Union protocol `UnionGovernor timelock` contract address
    address public immutable timelock;
    /// @notice Minimum UNION tokens required to create a crowd proposal
    uint public unionStakeAmount;

    /// @notice An event emitted when a crowd proposal is created
    event CrowdProposalCreated(address indexed proposal, address indexed author, address[] targets, uint[] values, string[] signatures, bytes[] calldatas, string description);

    event StakeAmountChange(uint oldAmount, uint newAmount);
     /**
     * @notice Construct a proposal factory for crowd proposals
     * @param union_ `UNION` token contract address
     * @param governor_ Union protocol `UnionGovernor` contract address
     * @param unionStakeAmount_ The minimum amount of UNION tokes required for creation of a crowd proposal
     */
    constructor(address union_,
                address governor_,
                address timelock_,
                uint unionStakeAmount_) public {
        union = union_;
        governor = governor_;
        timelock = timelock_;
        unionStakeAmount = unionStakeAmount_;
    }

    function setUnionStakeAmount(uint unionStakeAmount_) external {
        require(msg.sender == timelock, "only timelock");
        uint oldUnionStakeAmount = unionStakeAmount;
        unionStakeAmount = unionStakeAmount_;
        emit StakeAmountChange(oldUnionStakeAmount, unionStakeAmount);
    }

    /**
    * @notice Create a new crowd proposal
    * @notice Call `union.approve(factory_address, unionStakeAmount)` before calling this method
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
        CrowdProposal proposal = new CrowdProposal(msg.sender, targets, values, signatures, calldatas, description, union, governor);
        emit CrowdProposalCreated(address(proposal), msg.sender, targets, values, signatures, calldatas, description);

        // Stake UNION and force proposal to delegate votes to itself
        if(unionStakeAmount > 0){
            IUnion(union).transferFrom(msg.sender, address(proposal), unionStakeAmount);
        }
    }
}