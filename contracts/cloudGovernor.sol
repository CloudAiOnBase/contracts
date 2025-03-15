// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

// Author: CloudAI Dev Team
// Developed by @BullBoss5

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/governance/Governor.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorCountingSimple.sol";

interface ICloudStakeVault {
    function getDepositedBalance (address user)                     external view returns (uint256);
}

interface ICloudStaking {
    function totalStakedForTally()                                  external view returns (uint256);
}

contract CloudGovernor is 
    Governor, 
    GovernorCountingSimple
{
    IERC20              public cloudToken;
    ICloudStakeVault    public cloudStakeVault;
    ICloudStaking       public cloudStaking;

    uint256 public constant BLOCK_TIME = 2; // Block time in seconds
    uint256 private votingPeriodValue;
    uint256 private proposalThresholdValue;
    uint256 private quorumValue;

    mapping(uint256 => uint256) private _quorumSnapshotByBlock;

    struct ProposalWalletCount {
        uint256 againstWallets;
        uint256 forWallets;
        uint256 abstainWallets;
    }

    mapping(uint256 => ProposalWalletCount) private _proposalWalletCounts;


    event StakeVaultContractAddressUpdated  (address oldCloudStakeVault, address newCloudStakeVault);
    event StakingContractAddressUpdated     (address oldCloudStaking, address newCloudStaking);
    event GovernanceParamUpdated            (GovernanceParam param, uint256 newValue);

    constructor(
        address _cloudToken,
        address _cloudStakeVault,
        address _cloudStaking
    )
        Governor("CloudGovernor")
    {
        require(_cloudToken      != address(0), "Invalid token address");
        require(_cloudStakeVault != address(0), "Invalid stake vault address");
        require(_cloudStaking    != address(0), "Invalid staking address");

        votingPeriodValue      = 7 * 24 * 3600;      // 7 days in seconds
        proposalThresholdValue = 10_000 * 10**18;      // 10,000 CLOUD in wei
        quorumValue            = 10;                 // 10% quorum

        cloudToken      = IERC20(_cloudToken);
        cloudStakeVault = ICloudStakeVault(_cloudStakeVault);
        cloudStaking    = ICloudStaking(_cloudStaking);
    }

    // Enum to represent each governance parameter.
    enum GovernanceParam {
        VotingPeriodValue,              // 0  in days    example: 5
        ProposalThresholdValue,         // 1  in CLOUD   example: 10,000 
        QuorumValue                     // 2  in %       example: 10
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
        return 1; // 1 block delay
    }

    function votingPeriod()                             public view override returns (uint256) {
        return votingPeriodValue / BLOCK_TIME;      //  (Seconds → Blocks conversion):
    }

    function proposalThreshold()                        public view override returns (uint256) {
        return proposalThresholdValue;           // Minimum votes required to create a proposal
    }

    // Override quorum() to return the saved quorum based on the snapshot block,
    // or compute the current quorum if no snapshot was saved.
    function quorum(uint256 blockNumber)                public view override returns (uint256) {
        uint256 savedQuorum = _quorumSnapshotByBlock[blockNumber];

        if (savedQuorum != 0) {
             return savedQuorum;
        }
        return _computeQuorum();
    }

    function getGovernanceParams()                      external view returns (
        uint256 _votingPeriodValue,
        uint256 _proposalThresholdValue,
        uint256 _quorumValue
    ) {
        _votingPeriodValue              = votingPeriodValue         / 24 / 3600;
        _proposalThresholdValue         = proposalThresholdValue    / 10**18;
        _quorumValue                    = quorumValue;
    }

    function proposalWalletCounts(uint256 proposalId)   public view returns (uint256 againstWallets, uint256 forWallets, uint256 abstainWallets) {
        ProposalWalletCount storage count = _proposalWalletCounts[proposalId];
        return (count.againstWallets, count.forWallets, count.abstainWallets);
    }

    // ============================================
    // INTERNAL FUNCTIONS
    // ============================================

    function _getVotes(address account, uint256, bytes memory /*params*/)   internal view override(Governor) returns (uint256)
    {
       return cloudStakeVault.getDepositedBalance(account);
    }

    function _computeQuorum() internal view returns (uint256) {
        uint256 totalVotes;
        try cloudStaking.totalStakedForTally() returns (uint256 stakingVotes) {
            totalVotes = stakingVotes;
        } catch {
            // Fallback to using total balance in StakeVault if staking contract call fails
            totalVotes = cloudToken.balanceOf(address(cloudStakeVault));
        }

        uint256 vaultBalance = cloudToken.balanceOf(address(cloudStakeVault));

        if (totalVotes > vaultBalance) {
            totalVotes = vaultBalance;
        }

        uint256 calculatedQuorum = (totalVotes * quorumValue) / 100;
        return calculatedQuorum > 0 ? calculatedQuorum : 1;
    }

    function _countVote(
        uint256 proposalId,
        address account,
        uint8 support, // 0 = Against, 1 = For, 2 = Abstain
        uint256 totalWeight, // Ensure it matches OpenZeppelin's function signature
        bytes memory params
    ) internal override(Governor, GovernorCountingSimple) returns (uint256) { // Ensure it returns uint256

        // Call the parent function and store the return value
        uint256 countedWeight = super._countVote(proposalId, account, support, totalWeight, params); 

        // Increment respective wallet counts (each wallet votes only once)
        if (support == 0) {
            _proposalWalletCounts[proposalId].againstWallets++;
        } else if (support == 1) {
            _proposalWalletCounts[proposalId].forWallets++;
        } else if (support == 2) {
            _proposalWalletCounts[proposalId].abstainWallets++;
        }

        // Return the counted weight to match the expected return type
        return countedWeight;
    }

    // ============================================
    // PUBLIC FUNCTIONS
    // ============================================

    function setStakeVaultContract  (address _newCloudStakeVault)                           external onlyGovernance {
        require(_newCloudStakeVault != address(0),                  "Invalid address");
        require(_newCloudStakeVault != address(cloudStakeVault),    "Same address already set");
        require(_newCloudStakeVault.code.length > 0,                "Not a contract");

        address oldCloudStakeVault     = address(cloudStakeVault);
        cloudStakeVault                = ICloudStakeVault(_newCloudStakeVault);

        emit StakeVaultContractAddressUpdated(oldCloudStakeVault, _newCloudStakeVault);
    }

    function setStakingContract     (address _newCloudStaking)                              external onlyGovernance {
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
    function updateGovernanceParameters(uint8[] calldata keys, uint256[] calldata values)   external onlyGovernance {

        require(keys.length == values.length, "Array lengths mismatch");

        for (uint256 i = 0; i < keys.length; i++) {
            require(keys[i] <= uint8(type(GovernanceParam).max), "Invalid governance param key");

            GovernanceParam param = GovernanceParam(keys[i]);

            if (param == GovernanceParam.VotingPeriodValue) {
                require(values[i] >= 3,                                         "votingPeriodValue must be >= 3");
                require(values[i] <=14,                                         "votingPeriodValue must be <= 14");

                votingPeriodValue = values[i] * 24 * 3600;
                emit GovernanceParamUpdated(param, values[i]);

            } else if (param == GovernanceParam.ProposalThresholdValue) {
                require(values[i] > 0,                                          "ProposalThresholdValue must be positive");
                require(values[i] <= 1_000_000,                                 "ProposalThresholdValue must be <= 1,000,000");

                proposalThresholdValue = values[i] * 10**18;
                emit GovernanceParamUpdated(param, values[i]);


            } else if (param == GovernanceParam.QuorumValue) {
                require(values[i] > 0,                                          "quorumValue must be positive");
                require(values[i] <= 50,                                        "quorumValue must be <= 50");

                quorumValue = values[i];
                emit GovernanceParamUpdated(param, values[i]);

             } else {
                revert("Invalid parameter key");
            }
        }
    }

    // Override propose() so that when a proposal is created, we capture the quorum
    function propose(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        string memory description
    ) public override returns (uint256) {
        uint256 proposalId                      = super.propose(targets, values, calldatas, description);
        uint256 snapshotBlock                   = proposalSnapshot(proposalId);             // Get the snapshot block for this proposal (Governor's internal snapshot)
        _quorumSnapshotByBlock[snapshotBlock]   = _computeQuorum();                         // Save the current quorum value for that snapshot block.

        return proposalId;
    }

}
