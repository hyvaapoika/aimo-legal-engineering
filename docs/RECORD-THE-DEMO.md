# Record this workflow

Record one continuous raw video through step 4, or split it at the numbered steps below. You do not need to make the raw recording two minutes. Keep normal speed and natural pauses; the final edit will be exactly two minutes. No terminal, phone call, voice approval, developer tools or spoken commentary is needed. Use a landscape browser window, ideally 1920×1080, with notifications hidden. Hold each important screen for 3–5 seconds. Steps 5–6 are optional backup evidence: the final film explains those background steps in animation and ends with an illustrated confirmation returning to the chef.

## Setup before recording

- Only if recording optional approval/order backup footage, open http://localhost:3100/operations in a second tab. If it shows a login, choose **Enter local demo workspace**. Finish login before filming.
- Open http://localhost:3100/agent. Select **Hotel breakfast** in **Kitchen**, open **Preferences**, and review the saved profile. The demo uses preferred yoghurt with its approved alternative, exact butter, and exact milk. Save preferences if not already saved; close Preferences. Profile changes persist.
- For this rehearsal on 15 November 2026, use delivery **2026-11-16**, Monday. If filming later, choose a valid future date. Keep the date consistent in the prompt and resulting order.
- Do one rehearsal. Stop and report an error if a result is unavailable or approval is disabled; don't replace it with an invented success.

## 1. Show plain-language search — homepage

Page: http://localhost:3100/

1. Start recording on the shop homepage. Click the large **Tell Aimo what you need** search field.
2. Type **lactose-free milk, 1 litre** at normal speed. Do not press Enter. Let the product results update.
3. Pause with the query and results visible. The lactose-free filter, product prices, pack sizes and availability should be readable. Prices are synthetic demo offers.
4. Click the product name **Valio semi skimmed milk 1 l lactose free UHT**. Pause on its product details, then click the panel’s **Close panel** button. You do not need to add it to the basket.

What this demonstrates: express a requirement without an exact supplier product name; see relevant choices while typing; inspect price/stock in the same place. Keep this clip normal speed so the video can honestly show responsiveness.

## 2. Ask for a prepared order — agent page

1. Click **Prepare my order** in the top navigation, or open http://localhost:3100/agent.
2. Choose **Hotel breakfast** under **Kitchen**. Leave Preferences closed after the pre-recording setup.
3. In the large request box, enter:

   **Prepare our usual breakfast order for delivery 2026-11-16. Keep exact product choices and use only our approved alternatives.**

4. Pause so the request can be read. Click **Prepare basket** once.
5. Keep recording the actual processing and the result. Waiting can be shortened later with an obvious edit; don't interrupt or repeatedly click Prepare.

What this demonstrates: reuse known preferences instead of selecting every recurring product manually.

## 3. Show the stock-out decision — same agent page

1. Stay on the result. If the product rows are hidden, click **All ingredients**.
2. Pause on **Breakfast yoghurt**. The selected yoghurt should be the approved alternative, with a note that the preferred product is unavailable.
3. Open its product dropdown briefly. Show the original option marked **Unavailable**, then dismiss the dropdown without changing the selected approved alternative.
4. Show **Breakfast butter** and **Breakfast milk**, labelled **Exact choice**.
5. Under **Breakfast milk**, change **Packs** from **24** to **30**, then click outside the field. Wait for the quantity and total to update. If your saved starting quantity differs, increase it by one legal whole pack and record that actual change instead.

There is no separate Swap button to hunt for here. Aimo has already selected the alternative allowed by the saved profile. You're recording the automatic suggestion and your ability to inspect/edit it.

What this demonstrates: less replacement searching; exact preferences preserved; the chef can still correct the draft.

## 4. Transfer to the basket and order — normal shop

1. Click **Use this basket** on the agent result.
2. The shop opens with **Your basket**. Pause on the transferred yoghurt, butter, milk, updated quantity and total. Scroll slowly only if needed.
3. Click **Order** once. Keep recording through the result.
4. Pause on **Sent for human review**. Note the product quantities and total so you can identify this same request in Operations.
5. You can stop the main recording here. We will animate the background agent/approval/order process and chef-facing confirmation. If you want to capture optional evidence too, click **Open human approval workspace** or switch to the Operations tab.

What this demonstrates: the generated draft becomes an actual purchasing proposal through familiar basket controls.

## 5. Optional backup: approve that request — Operations

Page: http://localhost:3100/operations

1. Open **Overview** if needed. Find the newest pending approval matching the breakfast products, delivery date, quantities and total from step 4. Do not approve an older rehearsal by accident. If several are identical, use the newest creation time and have the matching proposal checked before the final take.
2. Pause on the product lines, total and reason for review.
3. Click **Approve order** for that synthetic demo request.
4. Record the confirmation **Approval recorded. Your order is now placed.** The pending card should resolve.

What this demonstrates: the human decides when purchasing proceeds. All orders in this footage are simulated.

## 6. Optional backup: show the result — Operations

1. Click **Orders** in the sidebar.
2. Open the newly created order matching that request. Pause on its ID, product quantities, total and approval evidence.
3. For optional backup footage, click **Activity ledger**, then **Verify chain**, and pause on the verified message. We may only use the order detail in the main film because the runtime is tight.
4. Stop recording.

What this demonstrates: an order with evidence of what happened, not just an attractive draft screen.

## What the editor will animate

You do not need to record MCP, code, an external-agent terminal or an architecture diagram. We will explain that background using a labelled animation:

**Restaurant's agent → authenticated MCP / REST tools → Aimo product lookup and signed offers → purchasing rules → human approval → simulated order → confirmation returned to the chef.**

No calls or spoken approval are part of this experience. The final chef message is illustrated as an intended in-app confirmation, not a demonstrated SMS/email/WhatsApp integration. The current app records the order but does not yet deliver an automatic approval-completion notification back to the chef's shop screen. The animation must be visibly labelled and drawn, with no fabricated order or delivery facts.

This explains the implemented interface. It must not masquerade as footage of a live autonomous model run. The actual app footage carries the customer benefit; animation carries the architecture explanation.

## Send back

Send the original recording with no speed changes or music. Tell us if you repeated a step or encountered a problem. We will select the exact cuts, adjust the narration to the footage and combine it with the animations inside the 120-second timeline. Feature wording: **“Products update as you type”**, **“Saved kitchen preferences”**, **“Approved alternatives already selected”**, **“Review before purchasing”**, and **“Open to external purchasing agents.”** Do not add a numerical time-saving claim that hasn't been measured.
