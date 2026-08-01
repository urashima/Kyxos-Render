# UI Components

`@kyxos/ui-components` provides the shared Kyxos primitives and wraps the interaction surfaces used around PCUI. PCUI remains responsible for its stable panel behavior; Kyxos controls provide the visual contract and product-level states.

Exports include panels, sections, buttons, icon buttons, segmented tabs, toggle, slider, number/text/search/color/select inputs, status pills, badges, dialog, command palette, toast, progress, empty/error states, asset/preset cards, thumbnail strips, property rows and breadcrumbs.

Every component supports keyboard focus, visible focus rings, disabled state and ARIA attributes. Stateful components use `data-state` for `active`, `loading`, `error` and `selected`. Product inputs remain connected to the existing CommandBus and history merge keys; the component package does not mutate scene data.

The canonical interactive preview is `/studio/ui-lab/`. Add a component state there before using it in a product page.
