# VK Automobiles (Spare parts) — operating guide

## Start and setup

On the shop computer, extract the release ZIP and run Install.cmd. Double-click the VK Automobiles desktop shortcut: it starts the backend quietly, waits for readiness and opens the browser automatically. No console needs to stay open. Closing the browser leaves the backend running. After restarting Windows, click the shortcut again; automatic Windows startup is not installed. The app includes its own Node runtime and stores records under LocalAppData/VKAutomobiles/data, separately from application versions. It does not include development records: transfer genuine records using backup/download and restore if needed.

For the development checkout, run npm run launcher:local after building and open release/Local launcher/VK Automobiles.exe. Its records remain in data/shop.sqlite. Older console launchers remain available for development; stop their console with Ctrl+C before switching.

The installed application has a Maintenance folder with Stop shop, Restart shop and Status shop shortcuts. Portable/local launchers include matching CMD helpers. Before stopping/updating: save work, download a backup and sign out. Then stop, install the update and launch the new shortcut. A running old version or a foreign application on port 3000 produces an error instead of being silently stopped. Interrupted saves must be checked in bill history before retrying. Stopping the backend does not revoke persisted sessions.

Diagnostic logs and process state are in the launcher folder beside the selected database. Logs over 2 MB rotate on the next backend start with one previous copy retained. Startup errors produce a message; ask for assistance using the log files rather than deleting database or journal files.

The supplied profile is VK AutoMobiles, Spare Parts, Edavannapara, Malappuram, PINCODE: 673645, Phone: +917025724642. The owner can edit it in Settings & backup. No GST is calculated or collected. The receipt is a simple shop receipt. Verify the printed result on the actual A4 printer before using it at the counter.

## Login and user access

Create the owner account on the first launch, before handing the computer to staff. Choose a username (3-40 letters, numbers, dots, underscores or hyphens) and a password of at least 12 characters. Save the recovery code privately outside the shop computer; it is shown once. No default password exists. Each installed computer has its own accounts.

Automatic locking covers and disables the workspace while logout completes. If the network/backend is unavailable, the login page still requires signing in again instead of reopening the previous screen. If a backup warning appears, billing remains available, but check backup storage and create/download a fresh backup as soon as the issue is corrected.

The owner creates staff through Accounts & access. Give each person a separate account. Staff can search parts and history, bill at saved selling prices, receive purchases, add contacts without opening debts, and record collections or supplier payments. For stock/price edits, selling-price overrides, opening balances, contact edits, returns, cancellations, settings, reports, exports, backups and user management, the owner signs in to perform the action. There is no inline approval PIN.

Lock / sign out ends the current session. The app locks after 15 minutes without activity, and sessions last at most eight hours. Unsaved drafts can be lost on lock. Changing a password revokes all that user's sessions; disabling or resetting staff also revokes their sessions. Repeated unsuccessful attempts trigger a 15-minute wait.

Forgot owner password? uses the recovery code and a new password. A successful recovery replaces the old code with a new one and signs out everyone. Staff ask the owner for a password reset. Activity records begin with this version; old transactions cannot be retroactively assigned to a person.

Passwords are salted scrypt hashes and session tokens are hashed in the database. This does not encrypt the SQLite file or prevent a Windows administrator from altering it. Protect the Windows account and downloaded backups. Backups contain password hashes and business information; never publish them with the portfolio demo.

## Enter starting records

1. Label racks, count one rack, and add parts with names, brand, optional manufacturer number, vehicle models separated by commas, rack and opening quantity.
2. Set selling prices, optional purchase cost and low-stock levels. Blank cost means unknown; zero means a known zero cost. Confirm the count before saving. Similar names/part numbers produce a warning, not a forced merge.
3. Add customers and suppliers. Enter only the opening money already owed as of your cutover date, not historic bills that will also be entered as new transactions. Names are separate accounts even when they look alike.
4. Save and download a backup before beginning sales.

## Receive purchases

Open Purchases, choose a supplier, enter invoice/reference and document date, add each received part, quantity and unit cost. Enter immediate cash/UPI payment or leave zero for supplier credit. Review and post once. Stock increases; the unpaid amount becomes the supplier balance. Last recorded purchase cost is a catalogue reference, not an inventory valuation or profit calculation.

Supplier goods returns and supplier credit notes are phase two. Do not simulate them with a customer return or a fictional payment.

## Bill a customer

Open New bill / sales. Choose a customer for credit, or Walk-in for a fully paid sale. Search by part, vehicle, number or rack, add each part once, then edit its quantity and actual selling price. A lower line price can represent a discount. Choose full cash, full UPI, or enter both amounts. Any unpaid amount requires a named customer. Review and complete the sale.

The application checks current stock when posting, not just the displayed quantity. Retry an interrupted financial submission with the same details; request keys prevent duplicate posting. After an uncertain browser interruption, inspect bill history before starting a fresh bill.

View / print opens the saved receipt. Print A4 uses the browser print dialog; reprinting does not post again. Historical item names and prices remain as billed when catalogue details change.

## Credit collections and supplier payments

Open Customers or Suppliers, select Account / payment, enter cash and/or UPI and a note. Payments are allocated to the oldest outstanding document, including opening balances, then to the next. Overpayments are rejected. Recording a payment does not change stock. Account tables show documents, allocated payments, remaining amounts and payment/refund events. Contact details can be corrected without rewriting old bills.

## Customer returns and exchanges

Choose the original active bill in Returns. Enter the eligible returned quantity and choose Saleable or Damaged. Only saleable items go back into available stock. Return value uses the original line price. The app first reduces the original bill's outstanding amount; enter the exact remaining refund as cash and/or UPI. Explain the return and confirm.

Example: a returned item worth INR 280 against a bill still owing INR 260 clears that debt and requires INR 20 refund. A second return cannot exceed the remaining sold quantity. For an exchange, finish this return/refund and create a separate new sale; there is no hidden net settlement.

## Corrections

Use Edit for part details and default prices. Use Adjust stock for a physically recounted quantity with a reason; never rewrite opening quantities. History preserves the movement and before/after detail changes. A stale edit from another tab is rejected; reload first.

A posted sale or purchase cannot be silently edited/deleted. In its details, provide a cancellation reason and confirm reversal. This retains the cancelled document, reverses stock, and records the opposite of the original cash/UPI payment. Cancellation is blocked after returns or later allocated payments; reconcile these cases with records intact. A purchase can only be cancelled if its received quantities are still available. Cancellation is for an erroneous document, not a supplier goods return.

## Reports and export

Reports separate gross sales, cancellations, returns, net sales, purchases and actual cash/UPI flows. Document dates determine sales/purchase periods; return, cancellation and payment event timestamps use India time. Outgoing totals include supplier payments and customer refunds. Outstanding accounts and stock are current balances, not historical as-of valuations. Profit/valuation reports are deferred.

Export stock to CSV and records to JSON. These exports aid review; use SQLite backups for complete restoration, including audit and idempotency records.

## Backups and restore

A consistent daily local snapshot is created while the app is running (at startup and checked hourly). Manual backup creates another snapshot. Download copies to USB or another device regularly. Local snapshots are retained and should be monitored for disk usage; a disk failure can destroy the database and all same-disk backups.

Restore accepts app-generated current-schema SQLite files up to 50 MB. It checks integrity, foreign keys and schema. Close other shop tabs, select the file and type RESTORE VK AUTOMOBILES. A before-restore recovery snapshot is saved first. Business-data replacement is transactional, and requests are blocked during restore. Current accounts, recovery code and activity history are preserved; accounts inside the uploaded backup are not imported. All sessions are revoked after a successful restore: sign in again. Legacy version-three shop backups are accepted. Restoration rolls back the whole shop to that snapshot; later bills/payments are no longer present, so retain paper/source records. Reload every other tab afterward.

## Boundaries and rollout

This is a local, single-operator release. It has local owner/staff authentication, but no multi-shop access or cloud synchronisation. Keep it bound to 127.0.0.1. Supplier returns, barcode hardware, GST functionality and advanced costing remain deferred. Windows packaging is available; desktop shortcut installation and the physical printer still need checks on the shop machine. The portfolio demo, remote GitHub repository and hosted deployment have not been created.

Run a short parallel pilot with test transactions and the paper process, reconcile closing stock and balances, then agree a cutover. Don't claim the software is ready for live accounting solely because automated tests pass.
