import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const idToken = url.searchParams.get("id_token");

  let tokenAud = null;

  if (idToken) {
    try {
      const payload = idToken.split(".")[1];
      const decoded = JSON.parse(
        Buffer.from(payload, "base64url").toString("utf8"),
      );

      tokenAud = decoded.aud;
    } catch (error) {
      console.error("AUTH DEBUG: token payload okunamadi");
    }
  }

  console.log("AUTH DEBUG", {
    tokenAud,
    envApiKey: process.env.SHOPIFY_API_KEY || null,
    appUrl: process.env.SHOPIFY_APP_URL || null,
  });

  await authenticate.admin(request);

  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">Home</s-link>
        <s-link href="/app/additional">Additional page</s-link>
      </s-app-nav>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
