# Fit map: size charts to a per-region fit report

This folder reads the size chart of a shop page and compares it with your tape measurements. For each body region it gives one of four results: tight, snug, good or loose. It also picks a size. The avatar page will use the results to colour the 3D body.

The code is plain ES modules with no dependencies. It runs in the browser and in Node.

## Test it

The tests need Node 20 or later. They use the built-in `node:test` runner.

```bash
node --test fit-map/
```

The tests read four real men's charts from `fixtures/`: Nike tops, Nike bottoms, ASOS and Lululemon. They compare the parsed ranges with values read by hand from the tables. They also test both table layouts, the four fit results, and the size pick for a man who is 178 cm tall, with chest 100, waist 86 and hip 100.

## Use it

```js
import { parseSizeChart } from './sizechart.js';
import { fitReport, recommendSize, LEGEND } from './fit.js';

const chart = parseSizeChart(markdown, { brand: 'Lululemon', garment: 'tops', table: 'tops' });
const body = { height: 178, chest: 100, waist: 86, hip: 100 };
recommendSize(body, chart);        // { label: 'M', reason: 'every measured region is inside the size range' }
fitReport(body, chart, 'M');       // [{ region: 'chest', body: 100, lo: 99.1, hi: 101.6, delta: 0, status: 'good' }]
```

The input is the markdown of a page, for example the output of Firecrawl. If the page has more than one table, `table` selects one. It is a table index, or a word from the heading above the table. The default is the first table.

The parser accepts these forms:

- Sizes as columns (Nike, Lululemon) or sizes as rows (ASOS). If the header row contains no measurement name, the parser takes the sizes to be columns.
- Ranges such as `96 - 104` and `35"-36"`, and single values such as `86`. A single value gives a range where the low and high values are the same.
- Inches, which the parser converts to cm and rounds to 0.1 cm. A cell is in inches if its header says "Inches" or the cell contains `"`. Fractions such as `33 1/2"` are accepted. If a table gives the same measurement in inches and in cm, the parser uses the cm column.
- The prefix "To Fit", and open bounds such as `< 170` and `> 190`.
- These measurement names: chest or bust, waist, hip or hips, inside leg or inseam, and height. The parser ignores rows and columns with other names, for example neck.
- Extra size rows, such as the Lululemon alpha sizes. The parser stores them in `aliases`, for example waist size `32` has the alias `M`.

## Thresholds

The fit result of a region comes from `delta`. This is the distance in cm from your measurement to the nearest edge of the size range. It is positive above the range and negative below it.

| Result | Rule |
|---|---|
| tight | More than 2 cm above the range |
| snug | Above the range by 2 cm or less |
| good | Inside the range |
| loose | Below the range, by any amount |

The 2 cm limit is `SNUG_CM` in `fit.js`. Tape error is about 1 cm, and many charts step 4 to 8 cm between sizes. A garment that is 2 cm too small at one point is usually still wearable. `LEGEND` in `fit.js` holds the four results with a short text for the UI.

`recommendSize` takes the size with the smallest largest `delta`, in absolute value, over all your regions. If two sizes are equal, the size with the smaller `delta` at the priority region wins. Nike tells buyers that tops follow the chest and bottoms follow the hip. The default priority is the first region in this list that the chart has: chest, hip, waist, inseam, height. You can set it with `{ priority: 'waist' }`.

## Limits

- The code handles body-measurement charts only. It does not handle charts of garment measurements, such as a flat chest width or a garment length.
- The code does not know about stretch, fabric or cut. A stretch top that is snug can fit well.
- A chart with single values gives no range. For example, ASOS jeans size 34 is 86 cm. A body that is 1 cm away from the value is then snug or loose, not good.
- For height, "tight" means the garment is probably short, and "loose" means it is probably long.
- Loose has no upper limit. A size that is 10 cm too large shows the same result as one that is 1 cm too large. The `delta` value still shows the difference.
- The parser does not read unicode fractions such as `23¼`. Only the ASOS hat table, which is not used, has them.

## Files

| File | What it does |
|---|---|
| `sizechart.js` | Reads markdown tables and makes a chart in cm. |
| `fit.js` | Fit report per region, size pick, thresholds and legend. |
| `fit.test.mjs` | The tests. |
| `fixtures/*.md` | The size tables from the Nike, ASOS and Lululemon pages, copied from the scraped pages. |
