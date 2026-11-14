import type { Order } from "@aimo/schema";
const xml = (value: string | number) =>
  String(value).replace(
    /[<>&"']/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
const units: Record<string, string> = {
  ST: "C62",
  KG: "KGM",
  L: "LTR",
  KI: "XBX",
  RAS: "XBX",
};
export function exportOrder(order: Order): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Order xmlns="urn:oasis:names:specification:ubl:schema:xsd:Order-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>urn:fdc:peppol.eu:poacc:trns:order:3</cbc:CustomizationID>
  <cbc:ProfileID>urn:fdc:peppol.eu:poacc:bis:ordering:3</cbc:ProfileID>
  <cbc:ID>${xml(order.id)}</cbc:ID><cbc:IssueDate>${order.confirmedAt.slice(0, 10)}</cbc:IssueDate>
  <cbc:OrderTypeCode>220</cbc:OrderTypeCode>
  <cbc:Note>SIMULATED HACKATHON ORDER. Approval: ${xml(order.approvalId ?? "mandate")}. Verdict: ${xml(order.verdictId)}. GLNs are placeholders. Not for Peppol transmission.</cbc:Note>
  <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
  <cac:BuyerCustomerParty><cac:Party><cbc:EndpointID schemeID="0088">0000000000000</cbc:EndpointID><cac:PartyName><cbc:Name>${xml(order.customerId)}</cbc:Name></cac:PartyName><cac:PostalAddress><cbc:CityName>Helsinki</cbc:CityName><cac:Country><cbc:IdentificationCode>FI</cbc:IdentificationCode></cac:Country></cac:PostalAddress></cac:Party></cac:BuyerCustomerParty>
  <cac:SellerSupplierParty><cac:Party><cbc:EndpointID schemeID="0088">0000000000000</cbc:EndpointID><cac:PartyName><cbc:Name>Valio Aimo — challenge demo</cbc:Name></cac:PartyName><cac:PostalAddress><cbc:CityName>Helsinki</cbc:CityName><cac:Country><cbc:IdentificationCode>FI</cbc:IdentificationCode></cac:Country></cac:PostalAddress></cac:Party></cac:SellerSupplierParty>
  <cac:Delivery><cac:DeliveryLocation><cbc:ID>${xml(order.deliverySite)}</cbc:ID></cac:DeliveryLocation><cac:RequestedDeliveryPeriod><cbc:EndDate>${order.deliveryDate}</cbc:EndDate></cac:RequestedDeliveryPeriod></cac:Delivery>
  <cac:AnticipatedMonetaryTotal><cbc:LineExtensionAmount currencyID="EUR">${(order.totalCents / 100).toFixed(2)}</cbc:LineExtensionAmount><cbc:PayableAmount currencyID="EUR">${(order.totalCents / 100).toFixed(2)}</cbc:PayableAmount></cac:AnticipatedMonetaryTotal>
  ${order.lines.map((line, index) => `<cac:OrderLine><cac:LineItem><cbc:ID>${index + 1}</cbc:ID><cbc:Quantity unitCode="${units[line.salesUnit] ?? "C62"}">${line.qty}</cbc:Quantity><cbc:LineExtensionAmount currencyID="EUR">${(line.lineTotalCents / 100).toFixed(2)}</cbc:LineExtensionAmount><cac:Price><cbc:PriceAmount currencyID="EUR">${line.unitPrice}</cbc:PriceAmount><cbc:BaseQuantity unitCode="${units[line.salesUnit] ?? "C62"}">1</cbc:BaseQuantity></cac:Price><cac:Item><cbc:Description>Supplier sales unit: ${xml(line.salesUnit)}; offer ${xml(line.offerId)}</cbc:Description><cbc:Name>${xml(line.name)}</cbc:Name><cac:SellersItemIdentification><cbc:ID>${xml(line.productId)}</cbc:ID></cac:SellersItemIdentification>${line.gtin ? `<cac:StandardItemIdentification><cbc:ID schemeID="0160">${xml(line.gtin)}</cbc:ID></cac:StandardItemIdentification>` : ""}</cac:Item></cac:LineItem></cac:OrderLine>`).join("\n  ")}
</Order>`;
}
