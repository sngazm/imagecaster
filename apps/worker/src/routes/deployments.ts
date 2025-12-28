import { Hono } from "hono";
import type { Env, Deployment, DeploymentsResponse } from "../types";

const deployments = new Hono<{ Bindings: Env }>();

/**
 * Cloudflare Pages API レスポンス型
 */
interface CloudflarePagesDeployment {
  id: string;
  short_id: string;
  url: string;
  created_on: string;
  modified_on: string;
  latest_stage: {
    name: string;
    status: string;
    started_on: string | null;
    ended_on: string | null;
  };
  deployment_trigger: {
    type: string;
    metadata: {
      branch?: string;
      commit_hash?: string;
      commit_message?: string;
    };
  };
}

interface CloudflareApiResponse {
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  result: CloudflarePagesDeployment[];
}

/**
 * GET /api/deployments - 最新のデプロイ一覧を取得
 */
deployments.get("/", async (c) => {
  const { CLOUDFLARE_API_TOKEN, PAGES_PROJECT_NAME, R2_ACCOUNT_ID } = c.env;

  // 設定されていない場合は空のレスポンスを返す
  if (!CLOUDFLARE_API_TOKEN || !PAGES_PROJECT_NAME) {
    const response: DeploymentsResponse = {
      deployments: [],
      configured: false,
    };
    return c.json(response);
  }

  try {
    const apiUrl = `https://api.cloudflare.com/client/v4/accounts/${R2_ACCOUNT_ID}/pages/projects/${PAGES_PROJECT_NAME}/deployments?per_page=5`;

    const apiResponse = await fetch(apiUrl, {
      headers: {
        Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
        "Content-Type": "application/json",
      },
    });

    if (!apiResponse.ok) {
      console.error(`Cloudflare API error: ${apiResponse.status}`);
      return c.json({ error: "Failed to fetch deployments" }, 500);
    }

    const data = (await apiResponse.json()) as CloudflareApiResponse;

    if (!data.success) {
      console.error("Cloudflare API returned error:", data.errors);
      return c.json({ error: "Cloudflare API error" }, 500);
    }

    // snake_case → camelCase に変換
    const deploymentList: Deployment[] = data.result.map((d) => ({
      id: d.id,
      shortId: d.short_id,
      url: d.url,
      createdOn: d.created_on,
      modifiedOn: d.modified_on,
      latestStage: {
        name: d.latest_stage.name as Deployment["latestStage"]["name"],
        status: d.latest_stage.status as Deployment["latestStage"]["status"],
        startedOn: d.latest_stage.started_on,
        endedOn: d.latest_stage.ended_on,
      },
      deploymentTrigger: {
        type: d.deployment_trigger.type,
        metadata: {
          branch: d.deployment_trigger.metadata.branch,
          commitHash: d.deployment_trigger.metadata.commit_hash,
          commitMessage: d.deployment_trigger.metadata.commit_message,
        },
      },
    }));

    const response: DeploymentsResponse = {
      deployments: deploymentList,
      configured: true,
      websiteUrl: c.env.WEBSITE_URL,
      accountId: R2_ACCOUNT_ID,
      projectName: PAGES_PROJECT_NAME,
    };

    return c.json(response);
  } catch (err) {
    console.error("Error fetching deployments:", err);
    return c.json({ error: "Failed to fetch deployments" }, 500);
  }
});

export { deployments };
