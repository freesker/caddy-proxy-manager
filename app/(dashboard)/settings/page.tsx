import SettingsClient from "./SettingsClient";
import { getGeneralSettings, getAcmeSettings, getAuthentikSettings, getMetricsSettings, getLoggingSettings, getDnsSettings, getDnsProviderSettings, getSetting, getUpstreamDnsResolutionSettings, getGeoBlockSettings, getErrorPagesSettings, getTrustedProxiesSettings, getDefaultResponseSettings } from "@/src/lib/settings";
import { getInstanceMode, getSlaveLastSync, getSlaveMasterToken, isInstanceModeFromEnv, isSyncTokenFromEnv, getEnvSlaveInstances } from "@/src/lib/instance-sync";
import { toEnvSlaveInstanceView } from "@/src/lib/instance-sync-view";
import { listInstances } from "@/src/lib/models/instances";
import { listOAuthProviders } from "@/src/lib/models/oauth-providers";
import { listRoleMappings } from "@/src/lib/models/oauth-role-mappings";
import { listGroups } from "@/src/lib/models/groups";
import { DNS_PROVIDERS } from "@/src/lib/dns-providers";
import { config } from "@/src/lib/config";
import { requireAdmin } from "@/src/lib/auth";
import { redactDnsProviderSettingsForApi } from "@/src/lib/dns-providers";

export default async function SettingsPage() {
  await requireAdmin();

  // Check if configuration is from environment variables
  const modeFromEnv = isInstanceModeFromEnv();
  const tokenFromEnv = isSyncTokenFromEnv();

  const [general, acme, dnsProvider, authentik, metrics, logging, dns, upstreamDnsResolution, instanceMode, globalGeoBlock, globalErrorPages, trustedProxies, defaultResponse, oauthProviders, roleMappings, allGroups] = await Promise.all([
    getGeneralSettings(),
    getAcmeSettings(),
    getDnsProviderSettings(),
    getAuthentikSettings(),
    getMetricsSettings(),
    getLoggingSettings(),
    getDnsSettings(),
    getUpstreamDnsResolutionSettings(),
    getInstanceMode(),
    getGeoBlockSettings(),
    getErrorPagesSettings(),
    getTrustedProxiesSettings(),
    getDefaultResponseSettings(),
    listOAuthProviders(),
    listRoleMappings(),
    listGroups(),
  ]);

  const [overrideGeneral, overrideAcme, overrideDnsProvider, overrideAuthentik, overrideMetrics, overrideLogging, overrideDns, overrideUpstreamDnsResolution, overrideTrustedProxies, overrideDefaultResponse] =
    instanceMode === "slave"
      ? await Promise.all([
          getSetting("general"),
          getSetting("acme"),
          getSetting("dns_provider"),
          getSetting("authentik"),
          getSetting("metrics"),
          getSetting("logging"),
          getSetting("dns"),
          getSetting("upstream_dns_resolution"),
          getSetting("trusted_proxies"),
          getSetting("default_response")
        ])
      : [null, null, null, null, null, null, null, null, null, null];

  const [slaveToken, slaveLastSync] = instanceMode === "slave"
    ? await Promise.all([getSlaveMasterToken(), getSlaveLastSync()])
    : [null, null];

  const instances = instanceMode === "master" ? await listInstances() : [];
  const envInstances = instanceMode === "master"
    ? getEnvSlaveInstances().map(toEnvSlaveInstanceView)
    : [];

  const roleMappingProviders = oauthProviders.map((p) => ({ id: p.id, name: p.name }));
  const roleMappingGroups = allGroups.map((g) => ({ id: g.id, name: g.name }));

  return (
    <SettingsClient
      general={general}
      acme={acme}
      dnsProvider={dnsProvider ? redactDnsProviderSettingsForApi(dnsProvider) : null}
      dnsProviderDefinitions={DNS_PROVIDERS}
      authentik={authentik}
      metrics={metrics}
      logging={logging}
      dns={dns}
      upstreamDnsResolution={upstreamDnsResolution}
      trustedProxies={trustedProxies}
      defaultResponse={defaultResponse}
      globalGeoBlock={globalGeoBlock}
      globalErrorPages={globalErrorPages}
      oauthProviders={oauthProviders}
      roleMappings={roleMappings}
      roleMappingProviders={roleMappingProviders}
      roleMappingGroups={roleMappingGroups}
      baseUrl={config.baseUrl}
      instanceSync={{
        mode: instanceMode,
        modeFromEnv,
        tokenFromEnv,
        overrides: {
          general: overrideGeneral !== null,
          acme: overrideAcme !== null,
          dnsProvider: overrideDnsProvider !== null,
          authentik: overrideAuthentik !== null,
          metrics: overrideMetrics !== null,
          logging: overrideLogging !== null,
          dns: overrideDns !== null,
          upstreamDnsResolution: overrideUpstreamDnsResolution !== null,
          trustedProxies: overrideTrustedProxies !== null,
          defaultResponse: overrideDefaultResponse !== null
        },
        slave: instanceMode === "slave" ? {
          hasToken: Boolean(slaveToken),
          lastSyncAt: slaveLastSync?.at ?? null,
          lastSyncError: slaveLastSync?.error ?? null
        } : null,
        master: instanceMode === "master" ? { instances, envInstances } : null
      }}
    />
  );
}
