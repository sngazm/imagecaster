import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: {
          bindings: {
            // テスト用の環境変数
            IS_DEV: "true",
            // Presigned URL の生成を実際に走らせるためのダミー資格情報。
            // 署名を作るだけで R2 への通信は発生しない。
            R2_ACCOUNT_ID: "test-account",
            R2_BUCKET_NAME: "test-bucket",
            R2_ACCESS_KEY_ID: "test-access-key",
            R2_SECRET_ACCESS_KEY: "test-secret-key",
            R2_PUBLIC_URL: "https://test-bucket.example.com",
            // 公開したときに Discord の告知待ちに入るのを確かめるためのダミー。
            // 告知そのものは Cron からしか出ないので、テスト中に通信は起きない。
            DISCORD_WEBHOOK_URL: "https://discord.test/api/webhooks/0/dummy",
          },
        },
      },
    },
  },
});
