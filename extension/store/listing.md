# Chrome Web Store listing: Avatar Try-On

Copy each part into the matching field of the developer dashboard.

## Store listing tab

Name: Avatar Try-On

Summary (132 characters at most):
See how a t-shirt from the shop page you have open fits a 3D avatar built from your own measurements.

Category: Shopping

Language: English

Description:
Avatar Try-On shows you how a t-shirt fits before you buy it.

Type your height and body measurements once. The extension builds a 3D avatar with your shape. Then open a t-shirt on a shop, open the side panel and press Read page. The avatar puts on the shirt, in the colour you picked, and the panel tells you how each size fits at the chest and waist.

- Simulated cotton that hangs and moves on the body.
- A fit result for each size from the shop's size chart.
- Optional face photos give the avatar your skin tone and hair.
- Everything runs on your computer. Your measurements and photos never leave your browser.

Works on product pages that show a body-measurement size chart. It simulates t-shirts only.

Images:
- Icon: icons/icon-128.png (in the zip).
- Screenshots: store/screenshot-*.png (1280x800).
- Small promo tile: store/promo-440x280.png.

## Privacy practices tab

Single purpose:
Shows how a t-shirt from the open product page fits a 3D avatar built from the user's measurements.

Permission justifications:
- sidePanel: The extension's whole interface is a side panel next to the shop page.
- scripting: Reads the product name, colour, material and size chart from the shop page when the user presses Read page.
- activeTab: Lets Read page work on the tab where the user clicked the toolbar button, without other site access.
- storage: Keeps the user's measurements and optional face photos on their own computer, so they do not type them again.
- Host permissions (optional https://*/* and http://*/*): Asked for only when the user presses Read page on a shop. Shops are on many domains, and without this the extension cannot read the page again after the user picks another colour or size on the shop.

Remote code: No. All code and models are in the package.

Data usage (tick these):
- Personally identifiable information: No.
- Health information: No. (The measurements are clothing sizes. If the reviewer disagrees, tick it and say it stays on the device.)
- Personal communications, location, web history, user activity, financial, authentication: No.
- Website content: Yes. The product page text is read to dress the avatar and is not kept.
- Certify: not sold to third parties, not used for unrelated purposes, not used for creditworthiness.

Privacy policy URL: https://tim-jordan-1.github.io/avatar-tryon/privacy-policy

## Distribution tab

Visibility: Unlisted for the first release. Only people with the link can install it. Change it to Public after testers use it.
Regions: All regions.
Pricing: Free.
