pragma solidity 0.5.9;
pragma experimental "ABIEncoderV2";

import "@counterfactual/contracts/contracts/interfaces/CounterfactualApp.sol";
import "@counterfactual/contracts/contracts/libs/LibOutcome.sol";
import "@counterfactual/contracts/contracts/interfaces/Interpreter.sol";
import "@counterfactual/contracts/contracts/interpreters/ERC20TwoPartyDynamicInterpreter.sol";
import "openzeppelin-solidity/contracts/math/SafeMath.sol";


/// @title Simple Swap App
/// @notice This contract lets two parties swap one ERC20 or ETH asset for another

/// @dev NOTE: This currently wont work. We need state to have context into asset type?

contract SimpleSwapApp is CounterfactualApp {

  using SafeMath for uint256;

  struct AppState {
    LibOutcome.CoinTransfer[] coinTransfers // [AliceCoin1, BobCoin1, AliceCoin2, BobCoin2]
    bool finalized
  }

  struct SwapAction {
    uint256 swapAmount
    uint256 swapRate
    address initiatorCoinAddress
    address initiatorAccount
    bool finalize
  }

/// TODO: How should getTurnTaker work here?

//   /// @dev getTurnTaker always returns sender's address to enforce unidirectionality.
//   function getTurnTaker(
//     bytes calldata encodedState, address[] calldata /* signingKeys */
//   )
//     external
//     pure
//     returns (address)
//   {
//     AppState memory state = abi.decode(encodedState, (AppState));
//     return state.transfers[0].to;
//   }

  function computeOutcome(bytes calldata encodedState)
    external
    pure
    returns (bytes memory)
  {
    AppState memory state = abi.decode(encodedState, (AppState));
    return abi.encode(state.coinTransfers);
  }

  function applyAction(
    bytes calldata encodedState, bytes calldata encodedAction
  )
    external
    pure
    returns (bytes memory)
  {
    AppState memory state = abi.decode(encodedState, (AppState));
    SwapAction memory action = abi.decode(encodedAction, (SwapAction));

    // apply transition based on action
    AppState memory postState = applySwap(
      state,
      action.swapAmount,
      action.swapRate,
      action.initiatorCoinAddress,
      action.initiatorAccount
      action.finalize
    );
    return abi.encode(postState);
  }

  function isStateTerminal(bytes calldata encodedState)
    external
    pure
    returns (bool)
  {
    AppState memory appState = abi.decode(encodedState, (AppState));
    return appState.finalized;
  }

  function outcomeType()
    external
    pure
    returns (uint256)
  {
    return uint256(LibOutcome.CoinTransfer[]);
  }

  function applySwap(
    AppState memory state,
    uint256 swapAmount,
    uint256 swapRate,
    address initiatorCoinAddress,
    address initiatorAccount,
    bool finalize
  )
    internal
    pure
    returns (AppState memory)
  {
    //Need to find a good way to modify two different coinTransfer objects in lockstep

    // transfer asset1
    state.asset1Transfers[0].amount = state.asset1Transfers[0].amount.sub(turnTakerTransferAmount);
    state.asset1Transfers[1].amount = state.asset1Transfers[1].amount.add(turnTakerTransferAmount);

    // transfer asset2
    state.asset1Transfers[0].amount = state.asset1Transfers[0].amount.sub(turnTakerTransferAmount.mul(swapRate));
    state.asset1Transfers[1].amount = state.asset1Transfers[1].amount.add(turnTakerTransferAmount.mul(swapRate));

    // finalize if final transfer
    state.finalized = finalize;

    return state;
  }

}