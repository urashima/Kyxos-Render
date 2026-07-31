const parameters = new URLSearchParams(location.search);
const interactionDisabled =
  parameters.get('interaction') === '0' ||
  parameters.get('interaction') === 'false';

if (interactionDisabled) {
  document.documentElement.classList.add('kyxos-interaction-disabled');
}
