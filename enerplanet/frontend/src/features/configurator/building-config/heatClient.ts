/**
 * The transport the building configurator package runs on.
 *
 * It is this application's own axios instance, so the configurator inherits
 * the session cookie, the CSRF header and the token refresh on 401 rather than
 * carrying its own copy of any of them. Paths reach it relative to the API
 * root, which is what axios's baseURL already supplies.
 *
 * Module constant, not built per render: the provider rebuilds the package's
 * clients whenever this object changes identity.
 */

import type { HttpClient } from '@thd-spatial-ai/building-configurator';

import axios from '@/lib/axios';

export const heatClient: HttpClient = {
  get: (path, options) => axios.get(path, options).then((res) => res.data),
  post: (path, body, options) => axios.post(path, body, options).then((res) => res.data),
};
