import { checkBuiltAssets } from './lib/built-assets.mjs';

try {
  const result = await checkBuiltAssets(
    process.argv[2],
    process.env.BASE_PATH || '/',
  );
  console.log(
    `Built asset graph and extension ZIP passed (extension ${result.extensionVersion}).`,
  );
} catch (error) {
  console.error(`Built artifact gate failed: ${error.message}`);
  process.exitCode = 1;
}
