import { resolveDatabaseUrls } from './env';

// Every test talks to the derived `<name>_test` database, never to the development one.
const { baseUrl, testUrl } = resolveDatabaseUrls();
process.env.TEST_BASE_DATABASE_URL = baseUrl;
process.env.DATABASE_URL = testUrl;
