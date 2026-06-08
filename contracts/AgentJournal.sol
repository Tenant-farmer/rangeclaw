// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/// @title AgentJournal
/// @notice On-chain decision log for the RangeClaw autonomous LP agent.
///         Each entry records an AI agent's decision ("inference result written
///         on-chain"), creating a permanent, verifiable record on Mantle - the
///         Turing Test Hackathon's core thesis: "autonomous agents creating
///         verifiable, on-chain value."
contract AgentJournal {
    struct Decision {
        uint64  timestamp;  // block time (unix seconds)
        address agent;      // the agent wallet that logged it
        string  action;     // HOLD | WATCH | WIDEN | REBALANCE
        int24   tickLower;  // position range at decision time
        int24   tickUpper;
        uint256 priceE6;    // pool price * 1e6 (USDC per token)
        string  market;     // OPEN | PRE_MARKET | AFTER_HOURS | WEEKEND | HOLIDAY
        string  rationale;  // human-readable reasoning
    }

    Decision[] public decisions;

    event DecisionLogged(
        uint256 indexed id,
        address indexed agent,
        string  action,
        int24   tickLower,
        int24   tickUpper,
        uint256 priceE6,
        string  market,
        string  rationale,
        uint64  timestamp
    );

    /// @notice The AI-powered, on-chain-callable function: writes the agent's
    ///         inference result (its decision + rationale) permanently to Mantle.
    function logDecision(
        string calldata action,
        int24 tickLower,
        int24 tickUpper,
        uint256 priceE6,
        string calldata market,
        string calldata rationale
    ) external returns (uint256 id) {
        id = decisions.length;
        decisions.push(Decision(uint64(block.timestamp), msg.sender, action, tickLower, tickUpper, priceE6, market, rationale));
        emit DecisionLogged(id, msg.sender, action, tickLower, tickUpper, priceE6, market, rationale, uint64(block.timestamp));
    }

    // ---- realized outcomes: what actually happened to the guarded position ----
    uint256 public outcomeCount;
    event OutcomeLogged(uint256 indexed id, string pair, int256 feesE6, int256 pnlE6, uint64 timestamp);

    /// @notice Log the realized result (fees earned + mark-to-market PnL) of a
    ///         guarded position, so the journal proves OUTCOMES, not just actions.
    ///         feesE6 / pnlE6 are USD * 1e6 (pnl may be negative).
    function logOutcome(string calldata pair, int256 feesE6, int256 pnlE6) external returns (uint256 id) {
        id = outcomeCount++;
        emit OutcomeLogged(id, pair, feesE6, pnlE6, uint64(block.timestamp));
    }

    function count() external view returns (uint256) {
        return decisions.length;
    }

    function latest() external view returns (Decision memory) {
        require(decisions.length > 0, "AgentJournal: empty");
        return decisions[decisions.length - 1];
    }
}
