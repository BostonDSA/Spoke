import util from "util";
import {
  completeContactLoad,
  failedContactLoad,
  getTimezoneByZip
} from "../../../workers/jobs";
import { r } from "../../../server/models";
import { getConfig, hasConfig } from "../../../server/api/lib/config";
import httpRequest from "../../../server/lib/http-request.js";

export const setTimeoutPromise = util.promisify(setTimeout);

export const name = "actionnetwork";

export const envVars = Object.freeze({
  API_KEY: "ACTION_NETWORK_API_KEY",
  DOMAIN: "ACTION_NETWORK_API_DOMAIN",
  BASE_URL: "ACTION_NETWORK_API_BASE_URL",
  CACHE_TTL: "ACTION_NETWORK_ACTION_HANDLER_CACHE_TTL"
});

export const defaults = Object.freeze({
  DOMAIN: "https://actionnetwork.org",
  BASE_URL: "/api/v2",
  CACHE_TTL: 1800
});

export const makeUrl = url =>
  `${getConfig(envVars.DOMAIN) || defaults.DOMAIN}${getConfig(
    envVars.BASE_URL
  ) || defaults.BASE_URL}/${url}`;

export const makeAuthHeader = organization => ({
  "OSDI-API-Token": getConfig(envVars.API_KEY, organization)
});

export function displayName() {
  return "Action Network";
}

export function serverAdministratorInstructions() {
  return {
    environmentVariables: [],
    description: "",
    setupInstructions:
      "Nothing is necessary to setup since this is default functionality"
  };
}

export async function available(organization, user) {
  /// return an object with two keys: result: true/false
  /// these keys indicate if the ingest-contact-loader is usable
  /// Sometimes credentials need to be setup, etc.
  /// A second key expiresSeconds: should be how often this needs to be checked
  /// If this is instantaneous, you can have it be 0 (i.e. always), but if it takes time
  /// to e.g. verify credentials or test server availability,
  /// then it's better to allow the result to be cached
  return {
    result: true,
    expiresSeconds: 0
  };
}

export function addServerEndpoints(expressApp) {
  /// If you need to create API endpoints for server-to-server communication
  /// this is where you would run e.g. app.post(....)
  /// Be mindful of security and make sure there's
  /// This is NOT where or how the client send or receive contact data
  return;
}

export function clientChoiceDataCacheKey(campaign, user) {
  /// returns a string to cache getClientChoiceData -- include items that relate to cacheability
  return `${campaign.id}`;
}

const getPage = async (item, page, organization) => {
  const url = makeUrl(`${item}?page=${page}`);
  console.log(`HTTP GET ${url}`);
  try {
    const pageResponse = await httpRequest(url, {
      method: "GET",
      headers: {
        ...makeAuthHeader(organization)
      }
    })
      .then(async response => await response.json())
      .catch(error => {
        const message = `Error retrieving ${item} from ActionNetwork ${error}`;
        console.error(message);
        throw new Error(message);
      });

    return {
      item,
      page,
      pageResponse
    };
  } catch (caughtError) {
    console.error(
      `Error loading ${item} page ${page} from ActionNetwork ${caughtError}`
    );
    throw caughtError;
  }
};

const extractReceived = (item, responses) => {
  const toReturn = [];
  responses[item].forEach(response => {
    toReturn.push(...((response._embedded || [])[`osdi:${item}`] || []));
  });
  return toReturn;
};

export async function getActionNetworkPages(
  organization,
  endpoint,
  extractKey
) {
  let responses = {};
  responses[extractKey] = [];
  try {
    const firstPagePromises = [getPage(endpoint, 1, organization)];

    const [firstThingsResponse] = await Promise.all(firstPagePromises);

    responses[extractKey].push(firstThingsResponse.pageResponse);

    let pagesNeeded = {};
    pagesNeeded[endpoint] = firstThingsResponse.pageResponse.total_pages;

    const pageToDo = [];

    Object.entries(pagesNeeded).forEach(([item, pageCount]) => {
      for (let i = 2; i <= pageCount; ++i) {
        pageToDo.push([item, i, organization]);
      }
    });

    const REQUESTS_PER_SECOND = 4;
    const WAIT_MILLIS = 1100;
    let pageToDoStart = 0;

    while (pageToDoStart < pageToDo.length) {
      if (pageToDo.length > REQUESTS_PER_SECOND - firstPagePromises.length) {
        await exports.setTimeoutPromise(WAIT_MILLIS);
      }

      const pageToDoEnd = pageToDoStart + REQUESTS_PER_SECOND;
      const thisTranche = pageToDo.slice(pageToDoStart, pageToDoEnd);

      const pagePromises = thisTranche.map(thisPageToDo => {
        return getPage(...thisPageToDo);
      });

      const pageResponses = await Promise.all(pagePromises);

      pageResponses.forEach(pageResponse => {
        responses[pageResponse.item].push(pageResponse.pageResponse);
      });
      pageToDoStart = pageToDoEnd;
    }
  } catch (caughtError) {
    console.error(`Error loading choices from ActionNetwork ${caughtError}`);
    throw caughtError;
  }

  return [...extractReceived(extractKey, responses)];
}

export async function getContactLists(organization) {
  const toReturn = [];
  const fetched = await getActionNetworkPages(organization, "lists", "lists");
  const identifierRegex = /action_network:(.*)/;
  fetched.forEach(thing => {
    let identifier;

    (thing.identifiers || []).some(identifierCandidate => {
      const regexMatch = identifierRegex.exec(identifierCandidate);
      if (regexMatch) {
        identifier = regexMatch[1];
        return true;
      }
      return false;
    });

    if (!identifier || !thing.name) {
      return;
    }

    toReturn.push({
      name: `${thing.name || thing.title}`,
      identifier: `${identifier}`
    });
  });
  return toReturn;
}

export async function getPerson(organization, identifier) {
  const url = makeUrl(`people/${identifier}`);
  console.log(`HTTP GET ${url}`);
  try {
    const response = await httpRequest(url, {
      method: "GET",
      headers: {
        ...makeAuthHeader(organization)
      }
    })
      .then(async response => await response.json())
      .catch(error => {
        const message = `Error retrieving person from ActionNetwork ${error}`;
        console.error(message);
        throw new Error(message);
      });
    return response;
  } catch (caughtError) {
    console.error(`Error loading person from ActionNetwork ${caughtError}`);
    throw caughtError;
  }
}

function makeContact(person, campaignId) {
  if (!("Phone" in person.custom_fields)) {
    throw new Error("Contact missing Phone field");
  }
  // TODO: Use primary address instead of first?
  // Maybe use Boston zip code by default? It's only used for timezone information.
  if (person.postal_addresses.length == 0) {
    throw new Error("Contact missing postal address");
  }
  return {
    first_name: `${person.given_name}`,
    last_name: `${person.family_name}`,
    cell: `+1${person.custom_fields.Phone}`,
    zip: person.postal_addresses[0].postal_code,
    timezone_offset: getTimezoneByZip(person.postal_addresses[0].postal_code),
    message_status: "needsMessage",
    campaign_id: campaignId
  };
}

export async function getContactsFromList(
  organization,
  campaignId,
  listIdentifier
) {
  const items = await getActionNetworkPages(
    organization,
    `lists/${listIdentifier}/items`,
    "items"
  );
  let people = [];
  for (const item of items) {
    if ("action_network:person_id" in item) {
      try {
        const person = await getPerson(
          organization,
          item["action_network:person_id"]
        );
        people.push(makeContact(person, campaignId));
      } catch (caughtError) {}
    }
  }

  return people;
}

export async function getClientChoiceData(organization, campaign, user) {
  /// data to be sent to the admin client to present options to the component or similar
  /// The react-component will be sent this data as a property
  /// return a json object which will be cached for expiresSeconds long
  /// `data` should be a single string -- it can be JSON which you can parse in the client component
  try {
    const toReturn = await getContactLists(organization);
    return {
      data: `${JSON.stringify({ items: toReturn })}`,
      expiresSeconds:
        Number(getConfig(envVars.CACHE_TTL, organization)) || defaults.CACHE_TTL
    };
  } catch (caughtError) {
    return {
      data: `${JSON.stringify({
        error: "Failed to load choices from ActionNetwork"
      })}`
    };
  }
}

export async function processContactLoad(job, maxContacts, organization) {
  /// Trigger processing -- this will likely be the most important part
  /// you should load contacts into the contact table with the job.campaign_id
  /// Since this might just *begin* the processing and other work might
  /// need to be completed asynchronously after this is completed (e.g. to distribute loads)
  /// After true contact-load completion, this (or another function)
  /// MUST call src/workers/jobs.js::completeContactLoad(job)
  ///   The async function completeContactLoad(job) will
  ///      * delete contacts that are in the opt_out table,
  ///      * delete duplicate cells,
  ///      * clear/update caching, etc.
  /// The organization parameter is an object containing the name and other
  ///   details about the organization on whose behalf this contact load
  ///   was initiated. It is included here so it can be passed as the
  ///   second parameter of getConfig in order to retrieve organization-
  ///   specific configuration values.
  /// Basic responsibilities:
  /// 1. Delete previous campaign contacts on a previous choice/upload
  /// 2. Set campaign_contact.campaign_id = job.campaign_id on all uploaded contacts
  /// 3. Set campaign_contact.message_status = "needsMessage" on all uploaded contacts
  /// 4. Ensure that campaign_contact.cell is in the standard phone format "+15551234567"
  ///    -- do NOT trust your backend to ensure this
  /// 5. If your source doesn't have timezone offset info already, then you need to
  ///    fill the campaign_contact.timezone_offset with getTimezoneByZip(contact.zip) (from "../../workers/jobs")
  /// Things to consider in your implementation:
  /// * Batching
  /// * Error handling
  /// * "Request of Doom" scenarios -- queries or jobs too big to complete

  const campaignId = job.campaign_id;

  await r
    .knex("campaign_contact")
    .where("campaign_id", campaignId)
    .delete();

  const contactData = JSON.parse(job.payload);
  // TODO: Enforce maxContacts.
  let actionNetworkContacts = await getContactsFromList(
    organization,
    campaignId,
    contactData.listIdentifier
  );

  await r.knex.batchInsert("campaign_contact", actionNetworkContacts, 100);

  await completeContactLoad(
    job,
    null,
    // see failedContactLoad above for descriptions
    String(contactData.requestContactCount),
    JSON.stringify({ finalCount: actionNetworkContacts.length })
  );
}
