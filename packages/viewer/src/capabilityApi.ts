import { KyxosViewer } from './KyxosViewer';

const originalGetCapabilities = KyxosViewer.prototype.getCapabilities;

KyxosViewer.prototype.getCapabilities = function getDetailedCapabilities() {
  const capabilities = originalGetCapabilities.call(this);
  const effects = this.getEffects();
  capabilities.effects = Object.fromEntries(
    Object.entries(effects).map(([name, settings]) => [
      name,
      {
        available: true,
        parameters: structuredClone(settings),
      },
    ]),
  );
  return capabilities;
};
