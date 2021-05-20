import type from "prop-types";
import React from "react";
import RaisedButton from "material-ui/RaisedButton";
import GSForm from "../../../components/forms/GSForm";
import Form from "react-formal";
import Subheader from "material-ui/Subheader";
import Divider from "material-ui/Divider";
import { ListItem, List } from "material-ui/List";
import CampaignFormSectionHeading from "../../../components/CampaignFormSectionHeading";
import CheckIcon from "material-ui/svg-icons/action/check-circle";
import WarningIcon from "material-ui/svg-icons/alert/warning";
import ErrorIcon from "material-ui/svg-icons/alert/error";
import { StyleSheet, css } from "aphrodite";
import yup from "yup";

export class CampaignContactsForm extends React.Component {
  state = {
    errorResult: null
  };

  render() {
    const { clientChoiceData, lastResult } = this.props;
    let actionNetworkLists = JSON.parse(clientChoiceData);
    let resultMessage = "";
    if (lastResult && lastResult.result) {
      const { message, finalCount } = JSON.parse(lastResult.result);
      resultMessage = message
        ? message
        : `Final count was ${finalCount} when you chose ${lastResult.reference}`;
    }

    return (
      <GSForm
        schema={yup.object({
          requestContactCount: yup.number().integer(),
          listIdentifier: yup
            .string()
            .oneOf(actionNetworkLists.items.map(list => list.identifier))
            .required("Please select a list from the dropdown.")
        })}
        onChange={formValues => {
          this.setState({ ...formValues });
          this.props.onChange(JSON.stringify(formValues));
        }}
        onSubmit={formValues => {
          // sets values locally
          this.setState({ ...formValues });
          // triggers the parent to update values
          this.props.onChange(JSON.stringify(formValues));
          // and now do whatever happens when clicking 'Next'
          this.props.onSubmit();
        }}
      >
        <Form.Field
          name="requestContactCount"
          type="number"
          label="Max # of Contacts (100)"
          initialValue={100}
        />
        <br />
        <Form.Field
          name="listIdentifier"
          type="select"
          floatingLabelText="Choose a list"
          fullWidth
          choices={actionNetworkLists.items.map(list => ({
            label: list.name,
            value: list.identifier
          }))}
        />

        <Form.Button
          type="submit"
          disabled={this.props.saveDisabled}
          label={this.props.saveLabel}
        />
      </GSForm>
    );
  }
}

CampaignContactsForm.propTypes = {
  onChange: type.func,
  onSubmit: type.func,
  campaignIsStarted: type.bool,

  icons: type.object,

  saveDisabled: type.bool,
  saveLabel: type.string,

  clientChoiceData: type.string,
  jobResultMessage: type.string,
  lastResult: type.object
};
