const http = require("node:http");
const https = require("node:https");
const blocked = () => {
  throw new Error("network attempt trapped");
};
global.fetch = blocked;
http.request = blocked;
http.get = blocked;
https.request = blocked;
https.get = blocked;
