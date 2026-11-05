import type { MouseEvent } from 'react';
import { getInstanceByDom } from 'echarts';
import { Download } from 'lucide-react';
import { useTranslation } from '@spatialhub/i18n';

/** Downloads the chart in the same card as a PNG; sits next to the card title. */
const SaveChartButton = ({ name }: { name: string }) => {
  const { t } = useTranslation();
  const label = t('results.saveImage', 'Save as PNG');

  const save = (event: MouseEvent<HTMLButtonElement>) => {
    let card = event.currentTarget.parentElement;
    while (card && !card.querySelector('[_echarts_instance_]')) card = card.parentElement;
    const dom = card?.querySelector<HTMLElement>('[_echarts_instance_]');
    const chart = dom ? getInstanceByDom(dom) : undefined;
    if (!card || !chart) throw new Error(`No chart found for the save button "${name}"`);
    const link = document.createElement('a');
    link.href = chart.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: getComputedStyle(card).backgroundColor });
    link.download = `${name}.png`;
    link.click();
  };

  return (
    <button type="button" onClick={save} title={label} aria-label={label} className="inline-flex cursor-pointer border-0 bg-transparent p-0">
      <Download className="h-4 w-4 text-gray-400 hover:text-gray-600 dark:text-gray-300 dark:hover:text-gray-200" />
    </button>
  );
};

export default SaveChartButton;
