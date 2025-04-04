// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

// Author: CloudAI Dev Team
// Developed by @BullBoss5

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/governance/Governor.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorCountingSimple.sol";

interface ICloudStaking {
    function totalStakedForTally()                                  external view returns (uint256);
    function userStakedForTally(address user, uint256 blockNumber)  external view returns (uint256);
}

contract CloudGovernor is 
    Governor, 
    GovernorCountingSimple
{
    using SafeERC20 for IERC20;

    IERC20              public cloudToken;
    ICloudStaking       public cloudStaking;

    uint256   public constant BLOCK_TIME = 2; // Block time in seconds
    uint256   private votingPeriodValue;
    uint256   private proposalThresholdValue;
    uint256   private quorumValue;
    uint256   private proposalDepositAmount;
    uint256   private vetoThresholdPercent;
    uint256[] public  proposalIds;
    
    struct ProposalWalletCount {
        uint256 againstWallets;
        uint256 forWallets;
        uint256 abstainWallets;
        uint256 vetoWallets;
    }

    struct ProposalMetadata {
        address   proposer;
        string    title;
        string    description;
        address[] targets;
        uint256[] values;
        bytes[]   calldatas;
        uint256   timestamp;
        uint256   block;
        uint256   quorum;
        uint256   totalVP;
        uint256   depositAmount;
        bool      depositClaimed;
    }

    mapping(uint256 => uint256)             private _quorumSnapshotByBlock;
    mapping(uint256 => bool)                public  allProposals;
    mapping(uint256 => ProposalWalletCount) public proposalWalletCounts;
    mapping(address => uint256)             private _lastActivityTime;
    mapping(uint256 => ProposalMetadata)    private _proposalsMetadata;

    // Mappings to record the vote choice and weight each voter has cast on a given proposal.
    mapping(uint256 => mapping(address => uint8)) public votes;
    mapping(uint256 => mapping(address => uint256)) public voteWeights;

    // Simple tally storage for the proposal votes.
    mapping(uint256 => uint256) public votesFor;
    mapping(uint256 => uint256) public votesAgainst;
    mapping(uint256 => uint256) public votesAbstain;
    mapping(uint256 => uint256) public votesVeto;

    event StakingContractAddressUpdated     (address oldCloudStaking, address newCloudStaking);
    event GovernanceParamUpdated            (GovernanceParam param, uint256 newValue);
    event DepositRefunded                   (uint256 indexed proposalId, address indexed proposer);
    event DepositSlashed                    (uint256 indexed proposalId, address indexed proposer);


    constructor(address _cloudToken, address _cloudStaking)  Governor("CloudGovernor")
    {
        require(_cloudToken      != address(0), "Invalid token address");
        require(_cloudStaking    != address(0), "Invalid staking address");

        votingPeriodValue      = 7 * 24 * 3600;      // 7 days in seconds
        proposalThresholdValue = 10_000 * 1e18;      // 10,000 CLOUD in wei
        quorumValue            = 33;                 // 33% quorum
        proposalDepositAmount  = 10_000 * 1e18;      // 10,000 CLOUD
        vetoThresholdPercent   = 33;                 // 33% veto thresold

        cloudToken      = IERC20(_cloudToken);
        cloudStaking    = ICloudStaking(_cloudStaking);
    }

    // Enum to represent each governance parameter.
    enum GovernanceParam {
        VotingPeriodValue,              // 0  in days    example: 5
        ProposalThresholdValue,         // 1  in CLOUD   example: 10,000 
        QuorumValue,                    // 2  in %       example: 33
        ProposalDepositAmount,          // 3  in CLOUD   example: 10,000
        VetoThresholdPercent            // 4  in %       example: 33
    }

    // ============================================
    // VIEW FUNCTIONS
    // ============================================

    // required by IERC6372 (used by Governor)
    function clock()                                    public view override returns (uint48) {
        return uint48(block.number);
    }

    // required by IERC6372 (used by Governor)
    function CLOCK_MODE()                               public pure override returns (string memory) {
        return "mode=blocknumber";
    }

    function votingDelay()                              public pure override returns (uint256) {
        return 3600 / BLOCK_TIME;                   // 1-hour delay to allow for verification by the proposer
    }

    function votingPeriod()                             public view override returns (uint256) {
        return votingPeriodValue / BLOCK_TIME;      //  (Seconds → Blocks conversion):
    }

    function proposalThreshold()                        public view override returns (uint256) {
        return proposalThresholdValue;              // Minimum votes required to create a proposal
    }

    function quorum(uint256 blockNumber)                public view override returns (uint256) {    
        return _quorumSnapshotByBlock[blockNumber];
    }

    function getGovernanceParams()                      external view returns (
        uint256 _votingPeriodValue,
        uint256 _proposalThresholdValue,
        uint256 _quorumValue,
        uint256 _proposalDepositAmount,
        uint256 _vetoThresholdPercent
    ) {
        _votingPeriodValue              = votingPeriodValue         / (24 * 3600);
        _proposalThresholdValue         = proposalThresholdValue    / 1e18;
        _quorumValue                    = quorumValue;
        _proposalDepositAmount          = proposalDepositAmount     / 1e18;
        _vetoThresholdPercent           = vetoThresholdPercent;
    }

    function getLastActivityTime(address user)          external view returns (uint256) {
        return _lastActivityTime[user];
    }

    function getProposalsPaginated(uint256 start, uint256 count) external view returns (uint256[] memory) {

        require(start < proposalIds.length, "Start index out of bounds");

        uint256 end = start + count;
        if (end > proposalIds.length) {
            end = proposalIds.length;
        }

        uint256[] memory paginatedProposals = new uint256[](end - start);
        for (uint256 i = start; i < end; i++) {
            paginatedProposals[i - start] = proposalIds[i];
        }

        return paginatedProposals;
    }

    function proposalVotes(uint256 proposalId)
        public
        view
        override
        returns (
            uint256 againstVotes,
            uint256 forVotes,
            uint256 abstainVotes
        )
    {
        againstVotes = votesAgainst[proposalId] + votesVeto[proposalId];
        forVotes     = votesFor[proposalId];
        abstainVotes = votesAbstain[proposalId];
    }

    function totalVotesOf(uint256 proposalId)               public view returns (uint256) {
        (
            uint256 againstVotes,
            uint256 forVotes,
            uint256 abstainVotes
        ) = proposalVotes(proposalId);

        return againstVotes + forVotes + abstainVotes;
    }

    function getProposalCount()                             external view returns (uint256) {
        return proposalIds.length;
    }

    function hasVoted(uint256 proposalId, address account)  public view override(IGovernor, GovernorCountingSimple) returns (bool) {
        return voteWeights[proposalId][account] > 0;
    }


    function proposalsMetadata(uint256 proposalId) external view returns (
        address proposer,
        string memory title,
        string memory description,
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        uint256 timestamp,
        uint256 blockNumber,
        uint256 quorumVotes,
        uint256 totalVP,
        uint256 depositAmount,
        bool depositClaimed
    ) {
        ProposalMetadata storage meta = _proposalsMetadata[proposalId];
        return (
            meta.proposer,
            meta.title,
            meta.description,
            meta.targets,
            meta.values,
            meta.calldatas,
            meta.timestamp,
            meta.block,
            meta.quorum,
            meta.totalVP,
            meta.depositAmount,
            meta.depositClaimed
        );
    }

    // ============================================
    // INTERNAL FUNCTIONS
    // ============================================

    function _voteSucceeded     (uint256 proposalId)                                                internal view override(Governor, GovernorCountingSimple) returns (bool) {
        return votesFor[proposalId] > (votesAgainst[proposalId] + votesVeto[proposalId]);
    }

    function _quorumReached     (uint256 proposalId)                                                internal view override(Governor, GovernorCountingSimple) returns (bool) {
        return totalVotesOf(proposalId) >= quorum(proposalSnapshot(proposalId));
    }

    function _getVotes          (address account, uint256 blockNumber, bytes memory /*params*/)     internal view override(Governor) returns (uint256)
    {
       return cloudStaking.userStakedForTally(account, blockNumber);
    }

    function _countVote(
        uint256 proposalId,
        address account,
        uint8 support, // 0 = Against, 1 = For, 2 = Abstain, 3 = No with Veto
        uint256 weight,
        bytes memory /*params*/
    ) internal override(Governor, GovernorCountingSimple) returns (uint256) {

        if (support == 1) {
            votesFor[proposalId] += weight;
        } else if (support == 0) {
            votesAgainst[proposalId] += weight;
        } else if (support == 2) {
            votesAbstain[proposalId] += weight;
        } else if (support == 3) {
            votesVeto[proposalId] += weight;
        } else {
            revert("invalid vote type");
        }

        if (support == 1) {
            proposalWalletCounts[proposalId].forWallets++;
        } else if (support == 0) {
            proposalWalletCounts[proposalId].againstWallets++;
        } else if (support == 2) {
            proposalWalletCounts[proposalId].abstainWallets++;
        } else if (support == 3) {
            proposalWalletCounts[proposalId].vetoWallets++;
        }

        _lastActivityTime[account] = block.timestamp;

        return weight;
    }

    // Internal function to allow proposeWithMetadata() to call propose()
    function _proposeInternal(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        string memory description
    ) internal returns (uint256) {
        return super.propose(targets, values, calldatas, description);
    }

    function _handleProposalDeposit(uint256 proposalId) internal {
        ProposalMetadata storage metadata = _proposalsMetadata[proposalId];

        if (metadata.depositClaimed) return;
        if (metadata.proposer == address(0)) return;

        uint256 totalVotes     = totalVotesOf(proposalId);
        uint256 propVetoVotes  = votesVeto[proposalId];

        bool    vetoed;
        if (totalVotes == 0) {
          vetoed = false;
        } else {
          vetoed = (propVetoVotes * 100 / totalVotes) >= vetoThresholdPercent;
        }

        metadata.depositClaimed = true;

        if (!vetoed || state(proposalId) == ProposalState.Succeeded || state(proposalId) == ProposalState.Executed || !_quorumReached(proposalId)) {
            // Refund
            cloudToken.safeTransfer(metadata.proposer, metadata.depositAmount);
            emit DepositRefunded(proposalId, metadata.proposer);
        } else {
           // Keep in treasury 
           emit DepositSlashed(proposalId, metadata.proposer);
        }
    }

    // Internal function to decrease the vote tally for a given support type.
    function _decreaseVote(uint256 proposalId, uint8 support, uint256 weight) internal {
        if (support == 1) {
            votesFor[proposalId]     -= weight;
            proposalWalletCounts[proposalId].forWallets--;
        } else if (support == 0) {
            votesAgainst[proposalId] -= weight;
            proposalWalletCounts[proposalId].againstWallets--;
        } else if (support == 2) {
            votesAbstain[proposalId] -= weight;
            proposalWalletCounts[proposalId].abstainWallets--;
        } else if (support == 3) {
            votesVeto[proposalId]    -= weight;
            proposalWalletCounts[proposalId].vetoWallets--;
        } else {
            revert("invalid vote type");
        }
    }

    // ============================================
    // PUBLIC FUNCTIONS
    // ============================================


    function setStakingContract         (address _newCloudStaking)                                  external onlyGovernance {
        require(_newCloudStaking != address(0),               "Invalid address");
        require(_newCloudStaking != address(cloudStaking),    "Same address already set");
        require(_newCloudStaking.code.length > 0,             "Not a contract");

        address oldCloudStaking     = address(cloudStaking);
        cloudStaking                = ICloudStaking(_newCloudStaking);

        emit StakingContractAddressUpdated(oldCloudStaking, _newCloudStaking);
    }

    /**
     * @notice Updates one or more governance parameters based on the provided keys and values.
     * @param keys An array of keys representing the governance parameters to update.
     *             Each key is a uint8 corresponding to a value in the GovernanceParam enum.
     * @param values An array of new values for the corresponding parameters.
     */
    function updateGovernanceParameters (uint8[] calldata keys, uint256[] calldata values)          external onlyGovernance {

        require(keys.length == values.length, "Array lengths mismatch");

        for (uint256 i = 0; i < keys.length; i++) {
            require(keys[i] <= uint8(type(GovernanceParam).max), "Invalid governance param key");

            GovernanceParam param = GovernanceParam(keys[i]);

            if (param == GovernanceParam.VotingPeriodValue) {
                require(values[i] >= 1,                                         "votingPeriodValue must be >= 1"); // low limit required for testnet
                require(values[i] <=14,                                         "votingPeriodValue must be <= 14");

                votingPeriodValue = values[i] * 24 * 3600;
                emit GovernanceParamUpdated(param, values[i]);

            } else if (param == GovernanceParam.ProposalThresholdValue) {
                require(values[i] > 0,                                          "proposalThresholdValue must be positive");
                require(values[i] <= 1_000_000,                                 "proposalThresholdValue must be <= 1,000,000");

                proposalThresholdValue = values[i] * 1e18;
                emit GovernanceParamUpdated(param, values[i]);


            } else if (param == GovernanceParam.QuorumValue) {
                require(values[i] > 0,                                          "quorumValue must be positive");
                require(values[i] <= 50,                                        "quorumValue must be <= 50");

                quorumValue = values[i];
                emit GovernanceParamUpdated(param, values[i]);

           } else if (param == GovernanceParam.ProposalDepositAmount) {
                require(values[i] > 0,                                          "proposalDepositAmount must be positive");
                require(values[i] <= 1_000_000,                                 "proposalDepositAmount must be <= 1,000,000");

                proposalDepositAmount = values[i] * 1e18;
                emit GovernanceParamUpdated(param, values[i]);

            } else if (param == GovernanceParam.VetoThresholdPercent) {
                require(values[i] >= 20,                                         "vetoThresholdPercent must be >= 20");
                require(values[i] <= 100,                                        "vetoThresholdPercent must be <= 100");

                vetoThresholdPercent = values[i];
                emit GovernanceParamUpdated(param, values[i]);


             } else {
                revert("Invalid parameter key");
            }
        }
    }

    function proposeWithMetadata(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        string memory title,
        string memory description
    ) public returns (uint256) {
        require(bytes(title).length > 0,            "Title cannot be empty");
        require(bytes(title).length <= 100,         "Title is too long (max 100 characters)");
        require(bytes(description).length > 0,      "Description cannot be empty");
        require(bytes(description).length <= 2000,  "Description is too long (max 2000 characters)");
        require(cloudToken.allowance(msg.sender, address(this)) >= proposalDepositAmount, "Insufficient token allowance");

        //Handle deposit
        cloudToken.safeTransferFrom(msg.sender, address(this), proposalDepositAmount);

        // Submit Proposal 
        uint256 proposalId                      = _proposeInternal(targets, values, calldatas, description);

        // Snapshot, Quorum...
        uint256 snapshotBlock                   = proposalSnapshot(proposalId);             // Get the snapshot block for this proposal (Governor's internal snapshot)
        uint256 totalStakedForTally             = cloudStaking.totalStakedForTally();
        uint256 calculatedQuorum                = totalStakedForTally > 0 ? totalStakedForTally * quorumValue / 100 : 1; 

        // Snapshot Quorum
        _quorumSnapshotByBlock[snapshotBlock]   = calculatedQuorum;      // Save the current quorum value for that snapshot block.

         // Track proposals &  Store proposal metadata
        proposalIds.push(proposalId);
        allProposals[proposalId]        = true;

        _proposalsMetadata[proposalId] = ProposalMetadata({
            proposer:       msg.sender,
            title:          title,
            description:    description,
            targets:        targets,
            values:         values,
            calldatas:      calldatas,
            timestamp:      block.timestamp,
            block:          snapshotBlock,
            quorum:         calculatedQuorum,
            totalVP:        totalStakedForTally,
            depositAmount:  proposalDepositAmount,
            depositClaimed: false
        });

        _lastActivityTime[msg.sender] = block.timestamp; // Record the proposer's activity time.

        return proposalId;
    }

    // Override propose() to block direct public calls
    function propose(
        address[] memory ,
        uint256[] memory ,
        bytes[] memory,
        string memory 
    ) public pure override returns (uint256) {
        revert("Use proposeWithMetadata() instead");
    }

    function claimDeposit(uint256 proposalId) external {
       require(state(proposalId) != ProposalState.Pending && state(proposalId) != ProposalState.Active, "Proposal not finished");
  
       _handleProposalDeposit(proposalId);
    }

    // Overrides castVote to allow a voter to change their vote if the proposal is still active.
    function castVote(uint256 proposalId, uint8 support) public override returns (uint256) {
        // Ensure the proposal is still active.
        require(state(proposalId) == ProposalState.Active, "voting is closed");

        // Get the current voting weight from the token snapshot.
        uint256 weight = getVotes(msg.sender, proposalSnapshot(proposalId));

        require(weight > 0, "no VP");

        // Check if the voter has already cast a vote.
        uint8 previousSupport = votes[proposalId][msg.sender];
        uint256 previousWeight = voteWeights[proposalId][msg.sender];

        // If a previous vote exists, subtract its weight from the current tally.
        if (previousSupport != 0 || previousWeight != 0) {
            _decreaseVote(proposalId, previousSupport, previousWeight);
        }

        // Record the new vote and weight.
        votes[proposalId][msg.sender] = support;
        voteWeights[proposalId][msg.sender] = weight;

        // Increase tally for the new vote.
        _countVote(proposalId, msg.sender, support, weight, bytes(""));

        emit VoteCast(msg.sender, proposalId, support, weight, "");

        return weight;
    }

}
