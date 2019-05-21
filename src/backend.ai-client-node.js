'use babel';
/*
Backend.AI Node.JS / Javascript ES6 API Library (v19.05.1)
==========================================================

(C) Copyright 2016-2019 Lablup Inc.
Licensed under MIT
*/
/*jshint esnext: true */
var fetch = require('node-fetch'); /* Exclude for ES6 */
var Headers = fetch.Headers; /* Exclude for ES6 */

var crypto = require('crypto');
var FormData = require('form-data');

const querystring = require('querystring');


class ClientConfig {
  constructor(accessKey, secretKey, endpoint) {
    // fixed configs with this implementation
    this._apiVersionMajor = 'v4';
    this._apiVersion = 'v4.20190115';
    this._hashType = 'sha256';
    // dynamic configs
    if (accessKey === undefined || accessKey === null)
      throw 'You must set accessKey! (either as argument or environment variable)';
    if (secretKey === undefined || secretKey === null)
      throw 'You must set secretKey! (either as argument or environment variable)';
    if (endpoint === undefined || endpoint === null)
      endpoint = 'https://api.backend.ai';
    this._endpoint = endpoint;
    this._endpointHost = endpoint.replace(/^[^:]+:\/\//, '');
    this._accessKey = accessKey;
    this._secretKey = secretKey;
    this._proxyURL = null;
    this._connectionMode = 'API';
  }

  get accessKey() {
    return this._accessKey;
  }

  get secretKey() {
    return this._secretKey;
  }

  get endpoint() {
    return this._endpoint;
  }

  get proxyURL() {
    return this._proxyURL;
  }

  get endpointHost() {
    return this._endpointHost;
  }

  get apiVersion() {
    return this._apiVersion;
  }

  get apiVersionMajor() {
    return this._apiVersionMajor;
  }

  get hashType() {
    return this._hashType;
  }

  get connectionMode() {
    return this._connectionMode;
  }

  get accessKey() {
    return this._accessKey;
  }

  /**
   * Create a ClientConfig object from environment variables.
   */
  static createFromEnv() {
    return new this(
      process.env.BACKEND_ACCESS_KEY,
      process.env.BACKEND_SECRET_KEY,
      process.env.BACKEND_ENDPOINT
    );
  }
}

class Client {
  /**
   * The client API wrapper.
   *
   * @param {ClientConfig} config - the API client-side configuration
   * @param {string} agentSignature - an extra string that will be appended to User-Agent headers when making API requests
   */
  constructor(config, agentSignature) {
    this.code = null;
    this.kernelId = null;
    this.kernelType = null;
    this.clientVersion = '0.4.0';  // TODO: read from package.json?
    this.agentSignature = agentSignature;
    if (config === undefined) {
      this._config = ClientConfig.createFromEnv();
    } else {
      this._config = config;
    }
    this.kernelPrefix = '/kernel';
    this.resourcePreset = new ResourcePreset(this);
    this.vfolder = new VFolder(this);
    this.agent = new Agent(this);
    this.keypair = new Keypair(this);
    this.image = new Image(this);
    this.utils = new utils(this);
    this.computeSession = new ComputeSession(this);
    this.resourcePolicy = new ResourcePolicy(this);
    this.resources = new Resources(this);
  }

  /**
   * Promise wrapper for asynchronous request to Backend.AI manager.
   *
   * @param {Request} rqst - Request object to send
   */
  async _wrapWithPromise(rqst) {
    let errorType = Client.ERR_REQUEST;
    let errorMsg;
    let resp, body;
    try {
      if (rqst.method == 'GET') {
        rqst.body = undefined;
      }
      resp = await fetch(rqst.uri, rqst);
      errorType = Client.ERR_RESPONSE;
      let contentType = resp.headers.get('Content-Type');
      if (contentType.startsWith('application/json') ||
        contentType.startsWith('application/problem+json')) {
        body = await resp.json();
      } else if (contentType.startsWith('text/')) {
        body = await resp.text();
      } else {
        if (resp.blob === undefined)
          body = await resp.buffer();  // for node-fetch
        else
          body = await resp.blob();
      }
      errorType = Client.ERR_SERVER;
      if (!resp.ok) {
        throw body;
      }
    } catch (err) {
      switch (errorType) {
        case Client.ERR_REQUEST:
          errorMsg = `sending request has failed: ${err}`;
          break;
        case Client.ERR_RESPONSE:
          errorMsg = `reading response has failed: ${err}`;
          break;
        case Client.ERR_SERVER:
          errorMsg = 'server responded failure: '
            + `${resp.status} ${resp.statusText} - ${body.title}`;
          break;
      }
      throw {
        type: errorType,
        message: errorMsg,
      };
    }
    return body;
  }

  /**
   * Return the server-side API version.
   */
  getServerVersion() {
    let rqst = this.newPublicRequest('GET', '', null, '');
    return this._wrapWithPromise(rqst);
  }

  /**
   * Return the resource slots.
   */
  getResourceSlots() {
    let rqst = this.newPublicRequest('GET', '/etcd/resource-slots', null, '');
    return this._wrapWithPromise(rqst);
  }

  /**
   * Create a compute session if the session for the given sessionId does not exists.
   * It returns the information for the existing session otherwise, without error.
   *
   * @param {string} kernelType - the kernel type (usually language runtimes)
   * @param {string} sessionId - user-defined session ID
   * @param {object} resources - Per-session resource
   */
  createIfNotExists(kernelType, sessionId, resources = {}) {
    if (sessionId === undefined)
      sessionId = this.generateSessionId();
    let params = {
      "lang": kernelType,
      "clientSessionToken": sessionId,
    };
    if (resources != {}) {
      let config = {};
      if (resources['cpu']) {
        config['cpu'] = resources['cpu'];
      }
      if (resources['mem']) {
        config['mem'] = resources['mem'];
      }
      if (resources['gpu']) { // Temporary fix for resource handling
        config['cuda.device'] = parseFloat(parseFloat(resources['gpu'])).toFixed(2);
      }
      if (resources['vgpu']) { // Temporary fix for resource handling
        config['cuda.shares'] = parseFloat(parseFloat(resources['vgpu'])).toFixed(2);
      }
      if (resources['tpu']) {
        config['tpu.device'] = resources['tpu'];
      }
      if (resources['env']) {
        config['environ'] = resources['env'];
      }
      if (resources['clustersize']) {
        config['clusterSize'] = resources['clustersize'];
      }
      //params['config'] = {};
      params['config'] = {resources: config};
      if (resources['mounts']) {
        params['config'].mounts = resources['mounts'];
      }
    }
    let rqst = this.newSignedRequest('POST', `${this.kernelPrefix}/create`, params);
    return this._wrapWithPromise(rqst);
  }

  /**
   * Obtain the session information by given sessionId.
   *
   * @param {string} sessionId - the sessionId given when created
   */
  getInformation(sessionId, ownerKey = null) {
    let queryString = `${this.kernelPrefix}/${sessionId}`;
    if (ownerKey != null) {
      queryString = `${queryString}?owner_access_key=${ownerKey}`;
    }
    let rqst = this.newSignedRequest('GET', queryString, null);
    return this._wrapWithPromise(rqst);
  }

  /**
   * Obtain the session information by given sessionId.
   *
   * @param {string} sessionId - the sessionId given when created
   */
  getLogs(sessionId, ownerKey = null) {
    let queryString = `${this.kernelPrefix}/${sessionId}/logs`;
    if (ownerKey != null) {
      queryString = `${queryString}?owner_access_key=${ownerKey}`;
    }
    let rqst = this.newSignedRequest('GET', queryString, null);
    return this._wrapWithPromise(rqst);
  }

  /**
   * Terminate and destroy the kernel session.
   *
   * @param {string} sessionId - the sessionId given when created
   */
  destroy(sessionId, ownerKey = null) {
    let queryString = `${this.kernelPrefix}/${sessionId}`;
    if (ownerKey != null) {
      queryString = `${queryString}?owner_access_key=${ownerKey}`;
    }
    let rqst = this.newSignedRequest('DELETE', queryString, null);
    return this._wrapWithPromise(rqst);
  }

  /**
   * Restart the kernel session keeping its work directory and volume mounts.
   *
   * @param {string} sessionId - the sessionId given when created
   */
  restart(sessionId, ownerKey = null) {
    let queryString = `${this.kernelPrefix}/${sessionId}`;
    if (ownerKey != null) {
      queryString = `${queryString}?owner_access_key=${ownerKey}`;
    }
    let rqst = this.newSignedRequest('PATCH', queryString, null);
    return this._wrapWithPromise(rqst);
  }

  // TODO: interrupt

  // TODO: auto-complete

  /**
   * Execute a code snippet or schedule batch-mode executions.
   *
   * @param {string} sessionId - the sessionId given when created
   * @param {string} runId - a random ID to distinguish each continuation until finish (the length must be between 8 to 64 bytes inclusively)
   * @param {string} mode - either "query", "batch", "input", or "continue"
   * @param {string} opts - an optional object specifying additional configs such as batch-mode build/exec commands
   */
  execute(sessionId, runId, mode, code, opts) {
    let params = {
      "mode": mode,
      "code": code,
      "runId": runId,
      "options": opts,
    };
    let rqst = this.newSignedRequest('POST', `${this.kernelPrefix}/${sessionId}`, params);
    return this._wrapWithPromise(rqst);
  }

  // legacy aliases
  createKernel(kernelType, sessionId = undefined, resources = {}) {
    return this.createIfNotExists(kernelType, sessionId, resources);
  }

  destroyKernel(kernelId, ownerKey = null) {
    return this.destroy(kernelId, ownerKey);
  }

  refreshKernel(kernelId, ownerKey = null) {
    return this.restart(kernelId, ownerKey);
  }

  runCode(code, kernelId, runId, mode) {
    return this.execute(kernelId, runId, mode, code, {});
  }

  upload(sessionId, path, fs) {
    const formData = new FormData();
    formData.append('src', fs, {filepath: path});
    let rqst = this.newSignedRequest('POST', `${this.kernelPrefix}/${sessionId}/upload`, formData);
    return this._wrapWithPromise(rqst);
  }

  mangleUserAgentSignature() {
    let uaSig = this.clientVersion
      + (this.agentSignature ? ('; ' + this.agentSignature) : '');
    return uaSig;
  }

  /* GraphQL requests */
  gql(q, v) {
    let query = {
      'query': q,
      'variables': v
    };
    let rqst = this.newSignedRequest('POST', `/admin/graphql`, query);
    return this._wrapWithPromise(rqst);
  }

  /**
   * Generate a RequestInfo object that can be passed to fetch() API,
   * which includes a properly signed header with the configured auth information.
   *
   * @param {string} method - the HTTP method
   * @param {string} queryString - the URI path and GET parameters
   * @param {string} body - an object that will be encoded as JSON in the request body
   */
  newSignedRequest(method, queryString, body) {
    let content_type = "application/json";
    let requestBody;
    let authBody;
    let d = new Date();
    if (body === null || body === undefined) {
      requestBody = '';
      authBody = requestBody;
    } else if (typeof body.getBoundary === 'function' || body instanceof FormData) {
      // detect form data input from form-data module
      requestBody = body;
      authBody = '';
      content_type = "multipart/form-data";
    } else {
      requestBody = JSON.stringify(body);
      authBody = requestBody;
    }
    //queryString = '/' + this._config.apiVersionMajor + queryString;
    let aStr;
    if (this._config._apiVersion[1] < 4) {
      aStr = this.getAuthenticationString(method, queryString, d.toISOString(), authBody, content_type);
    } else {
      aStr = this.getAuthenticationString(method, queryString, d.toISOString(), '', content_type);
    }
    if (this._config.connectionMode() === 'SESSION') { // Force request to use Public when session mode is enabled
      let hdrs = new Headers({
        "User-Agent": `Backend.AI Client for Javascript ${this.mangleUserAgentSignature()}`,
        "X-BackendAI-Version": this._config.apiVersion,
        "X-BackendAI-Date": d.toISOString()
      });
    } else {
      let signKey = this.getSignKey(this._config.secretKey, d);
      let rqstSig = this.sign(signKey, 'binary', aStr, 'hex');
      let hdrs = new Headers({
        "User-Agent": `Backend.AI Client for Javascript ${this.mangleUserAgentSignature()}`,
        "X-BackendAI-Version": this._config.apiVersion,
        "X-BackendAI-Date": d.toISOString(),
        "Authorization": `BackendAI signMethod=HMAC-SHA256, credential=${this._config.accessKey}:${rqstSig}`
      });
    }
    if (body != undefined) {
      if (typeof body.getBoundary === 'function') {
        hdrs.set('Content-Type', body.getHeaders()['content-type']);
      }
      if (body instanceof FormData) {
      } else {
        hdrs.set('Content-Type', content_type);
        hdrs.set('Content-Length', Buffer.byteLength(authBody));
      }
    } else {
      hdrs.set('Content-Type', content_type);
    }
    let uri = this._config.endpoint + queryString;


    let requestInfo = {
      method: method,
      headers: hdrs,
      cache: 'default',
      body: requestBody,
      uri: uri
    };
    return requestInfo;
  }

  /**
   * Same to newRequest() method but it does not sign the request.
   * Use this for unauthorized public APIs.
   */

  newUnsignedRequest(method, queryString, body) {
    return this.newPublicRequest(method, queryString, body, this._config.apiVersionMajor);
  }

  newPublicRequest(method, queryString, body, urlPrefix) {
    let d = new Date();
    let hdrs = new Headers({
      "Content-Type": "application/json",
      "User-Agent": `Backend.AI Client for Javascript ${this.mangleUserAgentSignature()}`,
      "X-BackendAI-Version": this._config.apiVersion,
      "X-BackendAI-Date": d.toISOString()
    });
    //queryString = '/' + urlPrefix + queryString;
    let requestInfo = {
      method: method,
      headers: hdrs,
      mode: 'cors',
      cache: 'default',
      uri: this._config.endpoint + queryString,
    };
    return requestInfo;
  }

  getAuthenticationString(method, queryString, dateValue, bodyValue, content_type = "application/json") {
    let bodyHash = crypto.createHash(this._config.hashType)
      .update(bodyValue).digest('hex');
    return (method + '\n' + queryString + '\n' + dateValue + '\n'
      + 'host:' + this._config.endpointHost + '\n'
      + 'content-type:' + content_type + '\n'
      + 'x-backendai-version:' + this._config.apiVersion + '\n'
      + bodyHash);
  }

  getCurrentDate(now) {
    let year = (`0000${now.getUTCFullYear()}`).slice(-4);
    let month = (`0${now.getUTCMonth() + 1}`).slice(-2);
    let day = (`0${now.getUTCDate()}`).slice(-2);
    let t = year + month + day;
    return t;
  }

  sign(key, key_encoding, msg, digest_type) {
    let kbuf = new Buffer(key, key_encoding);
    let hmac = crypto.createHmac(this._config.hashType, kbuf);
    hmac.update(msg, 'utf8');
    return hmac.digest(digest_type);
  }

  getSignKey(secret_key, now) {
    let k1 = this.sign(secret_key, 'utf8', this.getCurrentDate(now), 'binary');
    let k2 = this.sign(k1, 'binary', this._config.endpointHost, 'binary');
    return k2;
  }

  generateSessionId() {
    var text = "";
    var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (var i = 0; i < 8; i++)
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    return text + "-jsSDK";
  }
}

class ResourcePreset {
  /**
   * Resource Preset API wrapper.
   *
   * @param {Client} client - the Client API wrapper object to bind
   */
  constructor(client) {
    this.client = client;
    this.urlPrefix = '/resource'
  }

  /**
   * Return the GraphQL Promise object containing resource preset list.
   */
  list() {
    let rqst = this.client.newSignedRequest('GET', `${this.urlPrefix}/presets`, null);
    return this.client._wrapWithPromise(rqst);
  }

  /**
   * Return the GraphQL Promise object containing resource preset checking result.
   */
  check() {
    let rqst = this.client.newSignedRequest('POST', `${this.urlPrefix}/check-presets`, null);
    return this.client._wrapWithPromise(rqst);
  }
}

class VFolder {
  /**
   * The Virtual Folder API wrapper.
   *
   * @param {Client} client - the Client API wrapper object to bind
   * @param {string} name - Virtual folder name.
   */
  constructor(client, name = null) {
    this.client = client;
    this.name = name;
    this.urlPrefix = '/folders'
  }

  /**
   * Create a Virtual folder on specific host.
   *
   * @param {string} name - Virtual folder name.
   * @param {string} host - Host name to create virtual folder in it.
   */
  create(name, host = null) {
    let body = {
      'name': name,
      'host': host
    };
    let rqst = this.client.newSignedRequest('POST', `${this.urlPrefix}`, body);
    return this.client._wrapWithPromise(rqst);
  }

  /**
   * List Virtual folders that requested accessKey has permission to.
   */
  list() {
    let rqst = this.client.newSignedRequest('GET', `${this.urlPrefix}`, null);
    return this.client._wrapWithPromise(rqst);
  }

  /**
   * List Virtual folder hosts that requested accessKey has permission to.
   */
  list_hosts() {
    let rqst = this.client.newSignedRequest('GET', `${this.urlPrefix}/_/hosts`, null);
    return this.client._wrapWithPromise(rqst);
  }

  /**
   * Information about specific virtual folder.
   */
  info(name = null) {
    if (name == null) {
      name = this.name;
    }
    let rqst = this.client.newSignedRequest('GET', `${this.urlPrefix}/${name}`, null);
    return this.client._wrapWithPromise(rqst);
  }

  /**
   * Delete a Virtual folder.
   *
   * @param {string} name - Virtual folder name. If no name is given, use name on this VFolder object.
   */
  delete(name = null) {
    if (name == null) {
      name = this.name;
    }
    let rqst = this.client.newSignedRequest('DELETE', `${this.urlPrefix}/${name}`, null);
    return this.client._wrapWithPromise(rqst);
  }

  /**
   * Upload files to specific Virtual folder.
   *
   * @param {string} path - Path to upload.
   * @param {string} fs - File content to upload.
   * @param {string} name - Virtual folder name.
   */
  upload(path, fs, name = null) {
    if (name == null) {
      name = this.name;
    }
    let formData = new FormData();
    formData.append('src', fs, {filepath: path});
    let rqst = this.client.newSignedRequest('POST', `${this.urlPrefix}/${name}/upload`, formData);
    return this.client._wrapWithPromise(rqst);
  }

  /**
   * Upload file from formData to specific Virtual folder.
   *
   * @param {string} fss - formData with file specification. formData should contain {src, content, {filePath:filePath}}.
   * @param {string} name - Virtual folder name.
   */
  uploadFormData(fss, name = null) {
    let rqst = this.client.newSignedRequest('POST', `${this.urlPrefix}/${name}/upload`, fss);
    return this.client._wrapWithPromise(rqst);
  }

  /**
   * Create directory in specific Virtual folder.
   *
   * @param {string} path - Directory path to create.
   * @param {string} name - Virtual folder name.
   */
  mkdir(path, name = null) {
    if (name == null) {
      name = this.name;
    }
    let body = {
      'path': path
    };
    let rqst = this.client.newSignedRequest('POST', `${this.urlPrefix}/${name}/mkdir`, body);
    return this.client._wrapWithPromise(rqst);
  }

  /**
   * Delete multiple files in a Virtual folder.
   *
   * @param {string} files - Files to delete.
   * @param {boolean} recursive - delete files recursively.
   * @param {string} name - Virtual folder name that files are in.
   */
  delete_files(files, recursive = null, name = null) {

    if (name == null) {
      name = this.name;
    }
    if (recursive == null) {
      recursive = false;
    }
    let body = {
      'files': files,
      'recursive': recursive,
    };
    let rqst = this.client.newSignedRequest('DELETE', `${this.urlPrefix}/${name}/delete_files`, body);
    return this.client._wrapWithPromise(rqst);
  }

  /**
   * Download file in a Virtual folder.
   *
   * @param {string} file - File to download. Should contain full path.
   * @param {string} name - Virtual folder name that files are in.
   */
  download(file, name = false) {
    let params = {
      'file': file
    };
    let q = querystring.stringify(params);
    let rqst = this.client.newSignedRequest('GET', `${this.urlPrefix}/${name}/download_single?${q}`, null);
    return this.client._wrapWithPromise(rqst);
  }

  /**
   * List files in specific virtual folder / path.
   *
   * @param {string} path - Directory path to list.
   * @param {string} name - Virtual folder name to look up with.
   */
  list_files(path, name = null) {
    if (name == null) {
      name = this.name;
    }
    let params = {
      'path': path
    };
    let q = querystring.stringify(params);
    let rqst = this.client.newSignedRequest('GET', `${this.urlPrefix}/${name}/files?${q}`, null);
    return this.client._wrapWithPromise(rqst);
  }

  /**
   * Invite someone to specific virtual folder with permission.
   *
   * @param {string} perm - Directory path to list.
   * @param {array} emails - User E-mail to invite.
   * @param {string} name - Virtual folder name to invite.
   */
  invite(perm, emails, name = null) {
    if (name == null) {
      name = this.name;
    }
    let body = {
      'perm': perm,
      'user_ids': emails
    };
    let rqst = this.client.newSignedRequest('POST', `${this.urlPrefix}/${name}/invite`, body);
    return this.client._wrapWithPromise(rqst);
  }

  /**
   * Show invitations to current API key.
   */
  invitations() {
    let rqst = this.client.newSignedRequest('GET', `${this.urlPrefix}/invitations/list`, null);
    return this.client._wrapWithPromise(rqst);
  }

  /**
   * Accept specific invitation.
   *
   * @param {string} inv_id - Invitation ID.
   * @param {string} inv_ak - Access key to accept the invitation.
   */
  accept_invitation(inv_id, inv_ak) {
    let body = {
      'inv_id': inv_id,
      'inv_ak': inv_ak
    };
    let rqst = this.client.newSignedRequest('POST', `${this.urlPrefix}/invitations/accept`, body);
    return this.client._wrapWithPromise(rqst);
  }

  /**
   * Delete specific invitation.
   *
   * @param {string} inv_id - Invitation ID to delete.
   */
  delete_invitation(inv_id) {
    let body = {
      'inv_id': inv_id
    };
    let rqst = this.client.newSignedRequest('DELETE', `${this.urlPrefix}/invitations/delete`, body);
    return this.client._wrapWithPromise(rqst);
  }
}

class Agent {
  /**
   * Agent API wrapper.
   *
   * @param {Client} client - the Client API wrapper object to bind
   */
  constructor(client) {
    this.client = client;
  }

  /**
   * List computation agents.
   *
   * @param {string} status - Status to query. Should be one of 'ALIVE', 'PREPARING', 'TERMINATING' and 'TERMINATED'.
   * @param {array} fields - Fields to query. Queryable fields are:  'id', 'status', 'region', 'first_contact', 'cpu_cur_pct', 'mem_cur_bytes', 'available_slots', 'occupied_slots'.
   */
  list(status = 'ALIVE', fields = ['id', 'status', 'region', 'first_contact', 'cpu_cur_pct', 'mem_cur_bytes', 'available_slots', 'occupied_slots']) {
    if (['ALIVE', 'TERMINATED'].includes(status) === false) {
      return resolve(false);
    }
    let q = `query($status: String) {` +
      `  agents(status: $status) {` +
      `     ${fields.join(" ")}` +
      `  }` +
      `}`;
    let v = {'status': status};
    return this.client.gql(q, v);
  }
}

class Keypair {
  /**
   * Keypair API wrapper.
   *
   * @param {Client} client - the Client API wrapper object to bind
   */
  constructor(client, name = null) {
    this.client = client;
    this.name = name;
  }

  /**
   * Information of specific Keypair.
   *
   * @param {string} accessKey - Access key to query information. If client is not authorized as admin, this will be ignored and current API key infomation will be returned.
   * @param {array} fields - Fields to query. Queryable fields are: 'access_key', 'secret_key', 'is_active', 'is_admin', 'user_id', 'created_at', 'last_used',
   'concurrency_limit', 'concurrency_used', 'rate_limit', 'num_queries', 'resource_policy'.
   */
  info(accessKey, fields = ['access_key', 'secret_key', 'is_active', 'is_admin', 'user_id', 'created_at', 'last_used',
    'concurrency_limit', 'concurrency_used', 'rate_limit', 'num_queries', 'resource_policy']) {
    let q, v;
    if (this.client.is_admin) {
      q = `query($access_key: String!) {` +
        `  keypair(access_key: $access_key) {` +
        `    ${fields.join(" ")}` +
        `  }` +
        `}`;
      v = {
        'access_key': accessKey
      };
    } else {
      q = `query {` +
        `  keypair {` +
        `    ${fields.join(" ")}` +
        `  }` +
        `}`;
      v = {};
    }
    return this.client.gql(q, v);
  }

  /**
   * List Keypairs of given user ID.
   *
   * @param {string} userId - User ID to query API keys. If user ID is not given and client is authorized as admin, this will return every keypairs of the manager.
   * @param {array} fields - Fields to query. Queryable fields are: "access_key", 'is_active', 'is_admin', 'user_id', 'created_at', 'last_used',
   'concurrency_used', 'rate_limit', 'num_queries', 'resource_policy'.
   */
  list(userId = null, fields = ['access_key', 'is_active', 'is_admin', 'user_id', 'created_at', 'last_used',
    'concurrency_used', 'rate_limit', 'num_queries', 'resource_policy'], isActive = true) {

    let q;
    if (this.client.is_admin) {
      if (userId == null) {
        q = `query($is_active: Boolean) {` +
          `  keypairs(is_active: $is_active) {` +
          `    ${fields.join(" ")}` +
          `  }` +
          `}`;
      } else {
        q = `query($user_id: String!, $is_active: Boolean) {` +
          `  keypairs(user_id: $user_id, is_active: $is_active) {` +
          `    ${fields.join(" ")}` +
          `  }` +
          `}`;
      }
    } else {
      q = `query($user_id: String!, $is_active: Boolean) {` +
        `  keypairs(user_id: $user_id, is_active: $is_active) {` +
        `    ${fields.join(" ")}` +
        `  }` +
        `}`;
    }
    let v = {
      'user_id': userId || this.client.email,
      'is_active': isActive,
    };
    return this.client.gql(q, v);
  }

  /**
   * Add Keypair with given information.
   *
   * @param {string} userId - User ID for new Keypair.
   * @param {boolean} isActive - is_active state. Default is True.
   * @param {boolean} isAdmin - is_admin state. Default is False.
   * @param {string} resourcePolicy - resource policy name to assign. Default is `default`.
   * @param {integer} rateLimit - API rate limit for 900 seconds. Prevents from DDoS attack.
   */
  add(userId = null, isActive = true, isAdmin = false, resourcePolicy = 'default',
      rateLimit = 1000) {
    let fields = [
      'is_active',
      'is_admin',
      'resource_policy',
      'concurrency_limit',
      'rate_limit'
    ];
    let q = `mutation($user_id: String!, $input: KeyPairInput!) {` +
      `  create_keypair(user_id: $user_id, props: $input) {` +
      `    ok msg keypair { ${fields.join(" ")} }` +
      `  }` +
      `}`;
    let v = {
      'user_id': userId,
      'input': {
        'is_active': isActive,
        'is_admin': isAdmin,
        'resource_policy': resourcePolicy,
        'rate_limit': rateLimit
      },
    };
    return this.client.gql(q, v);
  }

  /**
   * mutate Keypair for given accessKey.
   *
   * @param {string} accessKey - access key to mutate.
   * @param {json} input - new information for mutation. JSON format should follow:
   * {
   *   'is_active': is_active,
   *   'is_admin': is_admin,
   *   'resource_policy': resource_policy,
   *   'rate_limit': rate_limit
   * }
   */
  mutate(accessKey, input) {
    let q = `mutation($access_key: String!, $input: ModifyKeyPairInput!) {` +
      `  modify_keypair(access_key: $access_key, props: $input) {` +
      `    ok msg` +
      `  }` +
      `}`;
    let v = {
      'access_key': accessKey,
      'input': input,
    };
    return this.client.gql(q, v);
  }

  /**
   * Delete Keypair with given accessKey
   *
   * @param {string} accessKey - access key to delete.
   */
  delete(accessKey) {
    let q = `mutation($access_key: String!) {` +
      `  delete_keypair(access_key: $access_key) {` +
      `    ok msg` +
      `  }` +
      `}`;
    let v = {
      'access_key': accessKey,
    };
    return this.client.gql(q, v);
  }
}


class ResourcePolicy {
  constructor(client) {
    this.client = client;
  }

  get(name = null, fields = ['name',
    'created_at',
    'default_for_unspecified',
    'total_resource_slots',
    'max_concurrent_sessions',
    'max_containers_per_session',
    'max_vfolder_count',
    'max_vfolder_size',
    'allowed_vfolder_hosts',
    'idle_timeout']) {
    let q, v;
    if (name === null) {
      q = `query {` +
        `  keypair_resource_policies { ${fields.join(" ")} }` +
        '}';
      v = {'n': name};
    } else {
      q = `query($n:String!) {` +
        `  keypair_resource_policy(name: $n) { ${fields.join(" ")} }` +
        '}';
      v = {'n': name};
    }
    return this.client.gql(q, v);
  }

  add(name = null, input) {
    let fields = ['name',
      'created_at',
      'default_for_unspecified',
      'total_resource_slots',
      'max_concurrent_sessions',
      'max_containers_per_session',
      'max_vfolder_count',
      'max_vfolder_size',
      'allowed_vfolder_hosts',
      'idle_timeout'];
    if (this.client.is_admin === true && name !== null) {
      let q = `mutation($name: String!, $input: CreateKeyPairResourcePolicyInput!) {` +
        `  create_keypair_resource_policy(name: $name, props: $input) {` +
        `    ok msg resource_policy { ${fields.join(" ")} }` +
        `  }` +
        `}`;
      let v = {
        'name': name,
        'input': input
      };
      return this.client.gql(q, v);
    } else {
      return resolve(false);
    }
  }

  mutate(name = null, input) {
    let fields = ['name',
      'created_at',
      'default_for_unspecified',
      'total_resource_slots',
      'max_concurrent_sessions',
      'max_containers_per_session',
      'max_vfolder_count',
      'max_vfolder_size',
      'allowed_vfolder_hosts',
      'idle_timeout'];
    if (this.client.is_admin === true && name !== null) {
      let q = `mutation($name: String!, $input: ModifyKeyPairResourcePolicyInput!) {` +
        `  modify_keypair_resource_policy(name: $name, props: $input) {` +
        `    ok msg resource_policy { ${fields.join(" ")} }` +
        `  }` +
        `}`;
      let v = {
        'name': name,
        'input': input
      };
      return this.client.gql(q, v);
    } else {
      return resolve(false);
    }
  }
}

class Image {
  constructor(client) {
    this.client = client;
  }

  list(fields = ["name", "tag", "registry", "digest", "installed", "resource_limits { key min max }"]) {
    let q, v;
    q = `query {` +
      `  images { ${fields.join(" ")} }` +
      '}';
    v = {};
    return this.client.gql(q, v);
  }
}

class ComputeSession {
  constructor(client) {
    this.client = client;
  }

  list(fields = ["sess_id", "lang", "created_at", "terminated_at", "status", "occupied_slots", "cpu_used", "io_read_bytes", "io_write_bytes"],
       status = 'RUNNING', accessKey = null) {
    let q, v;
    if (this.client.is_admin === true) {
      if (!accessKey) accessKey = null;
      q = `query($ak:String, $status:String) {` +
        `  compute_sessions(access_key:$ak, status:$status) { ${fields.join(" ")} }` +
        '}';
      v = {'status': status, 'ak': accessKey};
    } else {
      q = `query($status:String) {` +
        `  compute_sessions(status:$status) { ${fields.join(" ")} }` +
        '}';
      v = {'status': status};
    }
    return this.client.gql(q, v);
  }
}

class Resources {
  constructor(client) {
    this.client = client;
    this.resources = {};
    this._init_resource_values();
  }

  _init_resource_values() {
    this.resources.cpu = {};
    this.resources.cpu.total = 0;
    this.resources.cpu.used = 0;
    this.resources.cpu.percent = 0;
    this.resources.mem = {};
    this.resources.mem.total = 0;
    this.resources.mem.allocated = 0;
    this.resources.mem.used = 0;
    this.resources.gpu = {};
    this.resources.gpu.total = 0;
    this.resources.gpu.used = 0;
    this.resources['cuda.device'] = {};
    this.resources['cuda.device'].total = 0;
    this.resources['cuda.device'].used = 0;
    this.resources.vgpu = {};
    this.resources.vgpu.total = 0;
    this.resources.vgpu.used = 0;
    this.resources['cuda.shares'] = {};
    this.resources['cuda.shares'].total = 0;
    this.resources['cuda.shares'].used = 0;
    this.resources.agents = {};
    this.resources.agents.total = 0;
    this.resources.agents.using = 0;
    this.agents = [];
  }

  totalResourceInformation(status = 'ALIVE') {
    if (this.client.is_admin) {
      let fields = ['id',
        'addr',
        'status',
        'first_contact',
        'cpu_cur_pct',
        'mem_cur_bytes',
        'occupied_slots',
        'available_slots'];
      return this.client.agent.list(status, fields).then((response) => {
        this._init_resource_values();
        this.agents = response.agents;
        Object.keys(this.agents).map((objectKey, index) => {
          let value = this.agents[objectKey];
          let occupied_slots = JSON.parse(value.occupied_slots);
          let available_slots = JSON.parse(value.available_slots);
          this.resources.cpu.total = this.resources.cpu.total + parseInt(Number(available_slots.cpu));
          this.resources.cpu.used = this.resources.cpu.used + parseInt(Number(occupied_slots.cpu));
          this.resources.cpu.percent = this.resources.cpu.percent + parseFloat(value.cpu_cur_pct);

          if (occupied_slots.mem === undefined) {
            occupied_slots.mem = 0;
          }
          this.resources.mem.total = parseFloat(this.resources.mem.total) + parseInt(this.client.utils.changeBinaryUnit(available_slots.mem, 'b'));
          this.resources.mem.allocated = parseInt(this.resources.mem.allocated) + parseInt(this.client.utils.changeBinaryUnit(occupied_slots.mem, 'b'));
          this.resources.mem.used = parseInt(this.resources.mem.used) + parseInt(this.client.utils.changeBinaryUnit(value.mem_cur_bytes, 'b'));

          this.resources.gpu.total = parseInt(this.resources.gpu.total) + parseInt(Number(available_slots['cuda.device']));
          if ('cuda.device' in occupied_slots) {
            this.resources.gpu.used = parseInt(this.resources.gpu.used) + parseInt(Number(occupied_slots['cuda.device']));
          }
          this.resources.vgpu.total = parseFloat(this.resources.vgpu.total) + parseFloat(available_slots['cuda.shares']);
          if ('cuda.shares' in occupied_slots) {
            this.resources.vgpu.used = parseFloat(this.resources.vgpu.used) + parseFloat(occupied_slots['cuda.shares']);
          }
          if (isNaN(this.resources.cpu.used)) {
            this.resources.cpu.used = 0;
          }
          if (isNaN(this.resources.mem.used)) {
            this.resources.mem.used = 0;
          }
          if (isNaN(this.resources.gpu.used)) {
            this.resources.gpu.used = 0;
          }
          if (isNaN(this.resources.vgpu.used)) {
            this.resources.vgpu.used = 0;
          }
        });
        this.resources.vgpu.used = this.resources.vgpu.used.toFixed(2);
        this.resources.vgpu.total = this.resources.vgpu.total.toFixed(2);
        this.resources.agents.total = Object.keys(this.agents).length; // TODO : remove terminated agents
        this.resources.agents.using = Object.keys(this.agents).length;
        this.resources['cuda.shares'].used = this.resources.vgpu.used;
        this.resources['cuda.device'].used = this.resources.gpu.used;
        this.resources['cuda.shares'].total = this.resources.vgpu.total;
        this.resources['cuda.device'].total = this.resources.gpu.total;
        return this.resources;
      }).catch(err => {
        throw err;
      });
    } else {
      return Promise.resolve(false);
    }
  }
}

class utils {
  constructor(client) {
    this.client = client;
  }

  changeBinaryUnit(value, targetUnit = 'g', defaultUnit = 'b') {
    if (value === undefined) {
      return value;
    }
    let sourceUnit;
    const binaryUnits = ['b', 'k', 'm', 'g', 't', 'p', 'auto'];
    const bBinaryUnits = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
    if (!(binaryUnits.includes(targetUnit))) return false;
    value = value.toString();
    if (value.indexOf(' ') >= 0) { // Has string
      let v = value.split(/(\s+)/);
      if (bBinaryUnits.includes(v[2])) {
        value = v[0] + binaryUnits[bBinaryUnits.indexOf(v[2])];
      } else {
        value = v[0];
      }
    }
    if (binaryUnits.includes(value.substr(-1))) {
      sourceUnit = value.substr(-1);
      value = value.slice(0, -1);
    } else {
      sourceUnit = defaultUnit; // Fallback
    }
    if (targetUnit == 'auto') {

    }
    return value * Math.pow(1024, parseInt(binaryUnits.indexOf(sourceUnit) - binaryUnits.indexOf(targetUnit)));
  }

  elapsedTime(start, end) {
    var startDate = new Date(start);
    if (end === null) {
      var endDate = new Date();
    } else {
      var endDate = new Date(end);
    }
    var seconds_total = Math.floor((endDate.getTime() - startDate.getTime()) / 1000, -1);
    var seconds_cumulative = seconds_total;
    var days = Math.floor(seconds_cumulative / 86400);
    seconds_cumulative = seconds_cumulative - days * 86400;
    var hours = Math.floor(seconds_cumulative / 3600);
    seconds_cumulative = seconds_cumulative - hours * 3600;
    var minutes = Math.floor(seconds_cumulative / 60);
    seconds_cumulative = seconds_cumulative - minutes * 60;
    var seconds = seconds_cumulative;
    var result = '';
    if (days !== undefined && days > 0) {
      result = result + String(days) + ' Day ';
    }
    if (hours !== undefined) {
      result = result + this._padding_zeros(hours, 2) + ':';
    }
    if (minutes !== undefined) {
      result = result + this._padding_zeros(minutes, 2) + ':';
    }
    return result + this._padding_zeros(seconds, 2) + '';
  }

  _padding_zeros(n, width) {
    n = n + '';
    return n.length >= width ? n : new Array(width - n.length + 1).join('0') + n;
  }

  gqlToObject(array, key) {
    let result = {};
    array.forEach(function (element) {
      result[element[key]] = element;
    });
    return result;
  }

  gqlToList(array, key) {
    let result = [];
    array.forEach(function (element) {
      result.push(element[key]);
    });
    return result;
  }

}

// below will become "static const" properties in ES7
Object.defineProperty(Client, 'ERR_SERVER', {
  value: 0,
  writable: false,
  enumerable: true,
  configurable: false
});
Object.defineProperty(Client, 'ERR_RESPONSE', {
  value: 1,
  writable: false,
  enumerable: true,
  configurable: false
});
Object.defineProperty(Client, 'ERR_REQUEST', {
  value: 2,
  writable: false,
  enumerable: true,
  configurable: false
});


const backend = {
  Client: Client,
  ClientConfig: ClientConfig,
};

// for use like "ai.backend.Client"
module.exports.backend = backend;
// for classical uses
module.exports.Client = Client;
module.exports.ClientConfig = ClientConfig;
// legacy aliases
module.exports.BackendAIClient = Client;
module.exports.BackendAIClientConfig = ClientConfig;
