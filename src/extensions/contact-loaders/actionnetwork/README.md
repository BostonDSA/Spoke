# ActionNetwork Contact-Loader

This contact loader loads all contacts from a user-specified list from ActionNetwork.

## Installation

To install the ActionNetwork contact-loader, set the following ENV variables for the Spoke instance:

`CONTACT_LOADERS=actionnetwork`

`ACTION_NETWORK_API_KEY=<API key>`

Optionally, you can set `ACTION_NETWORK_CONTACT_LOADER_CACHE_TTL` to adjust the cache TTL in seconds.
The default TTL is 30 minutes.