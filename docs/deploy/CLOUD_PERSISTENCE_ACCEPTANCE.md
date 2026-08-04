# Cloud persistence acceptance

This deployment-only checkpoint exists to generate a fresh GitHub Pages preview from the current `main` branch after the cloud-persistence changes were merged.

Use the preview Studio to verify:

1. Sign in with a Supabase account.
2. Create a project on one device.
3. Sign in with the same account on another device and confirm the project is visible.
4. Import a GLB and wait for the explicit **Saved** state.
5. Publish an immutable version.
6. Open the generated Public Viewer link on another device.

Closed pull-request preview paths are not durable acceptance URLs. The stable production route is `/studio/`; an open PR preview may be used temporarily for isolated validation.
