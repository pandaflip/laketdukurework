import { prepareDatabase } from '../src/testing/database';
import { resolveDatabaseUrls } from './env';

export default async function setup(): Promise<void> {
  const { baseUrl, testUrl } = resolveDatabaseUrls();
  await prepareDatabase(baseUrl, testUrl);
}
