import { withStyles } from "@material-ui/core";
import PropTypes from "prop-types";
import React, { Component } from "react";

import MySnackbar from './snackBar';

const styles = theme => ({
  margin: {
    margin: theme.spacing(1)
  }
});

class Confirmations extends Component {
  render() {
    const { type, complete, closed } = this.props.pending;
    return (
      <div>

        <MySnackbar
          variant="warning"
          openWhen={type === "deposit" && !complete && !closed}
          onClose={() => this.props.closeConfirmations("deposit")}
          message="Processing deposit, we'll let you know when it's done."
          duration={30000}
        />

        <MySnackbar
          variant="warning"
          openWhen={type === "withdrawal" && !complete && !closed}
          onClose={() => this.props.closeConfirmations("withdraw")}
          message="Processing withdrawal, we'll let you know when it's done."
          duration={30000}
        />

        <MySnackbar
          variant="success"
          openWhen={type === "deposit" && complete && !closed}
          onClose={() => this.props.closeConfirmations()}
          message="Pending deposit confirmed!"
        />

        <MySnackbar
          variant="success"
          openWhen={type === "withdrawal" && complete && !closed}
          onClose={() => this.props.closeConfirmations()}
          message="Pending withdraw confirmed!"
        />

      </div>
    );
  }
}

Confirmations.propTypes = {
  classes: PropTypes.object.isRequired
};

export default withStyles(styles)(Confirmations);
