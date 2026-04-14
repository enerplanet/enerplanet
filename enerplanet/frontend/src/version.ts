// Central app version export. This pulls the version from package.json at build time.
import pkg from '../package.json';

export const APP_VERSION: string = pkg.version ?? '0.0.0';
