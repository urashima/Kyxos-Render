import { BrowserKyxosViewportAdapter } from './index';

function internals(adapter: BrowserKyxosViewportAdapter): Record<string, any> {
  return adapter as unknown as Record<string, any>;
}

BrowserKyxosViewportAdapter.prototype.loadEnvironmentAsset = async function loadEnvironmentAssetSafely(
  assetId?: string,
): Promise<void> {
  const internal = internals(this);
  const viewer = internal.viewer;
  const document = internal.document;
  if (!viewer || !document) {
    throw new Error('Viewport adapter is not mounted.');
  }
  if (!assetId) {
    viewer.clearEnvironmentAsset();
    return;
  }
  const asset = document.value.assets[assetId];
  if (!asset || asset.kind !== 'environment') {
    throw new Error(`Environment asset is missing: ${assetId}`);
  }
  await viewer.loadEnvironment(await internal.assetResolver.resolve(asset));
};
