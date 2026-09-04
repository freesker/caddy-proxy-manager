"use client";

import SwaggerUI from "swagger-ui-react";
import "swagger-ui-react/swagger-ui.css";
import "./swagger-ui-overrides.css";

/**
 * API documentation is bundled with the application. Keeping executable assets
 * same-origin avoids granting a mutable CDN administrator-level script access.
 */
export default function ApiDocsClient() {
  return (
    <div className="w-full min-h-[600px] -mx-4 md:-mx-8 -my-6 px-4 md:px-8 py-6">
      <SwaggerUI
        url="/api/v1/openapi.json"
        deepLinking
        defaultModelsExpandDepth={1}
      />
    </div>
  );
}
