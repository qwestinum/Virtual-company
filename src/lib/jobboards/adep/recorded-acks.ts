/**
 * Acquittements enregistrés, INLINE.
 *
 * ── POURQUOI EN TYPESCRIPT ET PAS EN LECTURE DE FICHIER ─────────────────────
 *
 * Le transport de recette (`mock-transport.ts`) est appelé depuis une route
 * Next lorsque `ADEP_ENABLED` est absent — c'est tout l'intérêt de pouvoir
 * dérouler la recette d'écran sans l'Apec. Or un `readFileSync` vers
 * `__tests__/fixtures` fonctionne en développement et **casse dans un bundle de
 * production** : les fichiers ne sont pas tracés. La panne arriverait le jour
 * de la démonstration, avec un message parlant de chemin de fichier.
 *
 * Les `.xml` restent la forme de RÉFÉRENCE — c'est là qu'on collera les vraies
 * réponses de l'Apec le jour où on en aura. Ce fichier les recopie, et
 * `__tests__/recorded-acks.test.ts` vérifie que les deux ne divergent JAMAIS : une copie
 * qu'aucun test ne surveille finit toujours par mentir.
 *
 * ⚠️ NE PAS ÉDITER À LA MAIN — modifier le `.xml` de `__tests__/fixtures/`, puis recopier ici.
 */

/** `ack-fatal-330.xml` */
export const ACK_FATAL_330 = `<?xml version="1.0" ?>
<S:Envelope xmlns:S="http://schemas.xmlsoap.org/soap/envelope/">
  <S:Body>
    <ns3:openPositionResponse xmlns:ns2="http://ns.hr-xml.org/2006-02-28" xmlns:ns3="http://adep.apec.fr/hrxml/sep">
      <ns2:PayloadResponseSummary>
        <ns2:UniquePayloadTrackingId idOwner="CLIENT">
          <ns2:IdValue>orqa-CAMP-2026-288-1757000000000</ns2:IdValue>
        </ns2:UniquePayloadTrackingId>
        <ns2:TransactionReceiptTimestamp>2026-09-08T15:55:02.475+02:00</ns2:TransactionReceiptTimestamp>
        <ns2:AcknowledgementCreationTimestamp>2026-09-08T15:55:48.369+02:00</ns2:AcknowledgementCreationTimestamp>
      </ns2:PayloadResponseSummary>
      <ns2:PayloadDisposition>
        <ns2:EntityDisposition>
          <ns2:EntityIdentifier idOwner="UNKNOWN">
            <ns2:IdValue>fr</ns2:IdValue>
          </ns2:EntityIdentifier>
          <ns2:EntityShortName>Order Language</ns2:EntityShortName>
          <ns2:EntityInstanceXPath>//position/@xml:lang</ns2:EntityInstanceXPath>
          <ns2:EntityNoException>true</ns2:EntityNoException>
        </ns2:EntityDisposition>
        <ns2:EntityDisposition>
          <ns2:EntityIdentifier idOwner="UNKNOWN">
            <ns2:IdValue>CDI</ns2:IdValue>
          </ns2:EntityIdentifier>
          <ns2:EntityShortName>Position Type</ns2:EntityShortName>
          <ns2:EntityInstanceXPath>//position/PositionProfile/PositionDetail/UserArea/JobType</ns2:EntityInstanceXPath>
          <ns2:EntityNoException>true</ns2:EntityNoException>
        </ns2:EntityDisposition>
        <ns2:EntityDisposition>
          <ns2:EntityIdentifier idOwner="CLIENT">
            <ns2:IdValue>CAMP-2026-288</ns2:IdValue>
          </ns2:EntityIdentifier>
          <ns2:EntityShortName>Staffing Order</ns2:EntityShortName>
          <ns2:EntityInstanceXPath>//position</ns2:EntityInstanceXPath>
          <ns2:EntityException>
            <ns2:Exception>
              <ns2:ExceptionIdentifier>330</ns2:ExceptionIdentifier>
              <ns2:ExceptionSeverity>Fatal</ns2:ExceptionSeverity>
              <ns2:ExceptionMessage>API_330_CLIENT_INDIRECT_ACCESS_ERROR</ns2:ExceptionMessage>
            </ns2:Exception>
          </ns2:EntityException>
        </ns2:EntityDisposition>
      </ns2:PayloadDisposition>
    </ns3:openPositionResponse>
  </S:Body>
</S:Envelope>
`;

/** `ack-fatal-390.xml` */
export const ACK_FATAL_390 = `<?xml version="1.0" ?>
<S:Envelope xmlns:S="http://schemas.xmlsoap.org/soap/envelope/">
  <S:Body>
    <ns3:openPositionResponse xmlns:ns2="http://ns.hr-xml.org/2006-02-28" xmlns:ns3="http://adep.apec.fr/hrxml/sep">
      <ns2:PayloadResponseSummary>
        <ns2:UniquePayloadTrackingId idOwner="CLIENT">
          <ns2:IdValue>orqa-CAMP-2026-288-1757000009999</ns2:IdValue>
        </ns2:UniquePayloadTrackingId>
      </ns2:PayloadResponseSummary>
      <ns2:PayloadDisposition>
        <ns2:EntityDisposition>
          <ns2:EntityIdentifier idOwner="CLIENT">
            <ns2:IdValue>CAMP-2026-288</ns2:IdValue>
          </ns2:EntityIdentifier>
          <ns2:EntityShortName>Position opening</ns2:EntityShortName>
          <ns2:EntityInstanceXPath>/PositionOpening</ns2:EntityInstanceXPath>
          <ns2:EntityException>
            <ns2:Exception>
              <ns2:ExceptionIdentifier>390</ns2:ExceptionIdentifier>
              <ns2:ExceptionSeverity>Fatal</ns2:ExceptionSeverity>
              <ns2:ExceptionMessage>API_390_MORE_THAN_ONE_REF_FOUND_ERROR</ns2:ExceptionMessage>
            </ns2:Exception>
          </ns2:EntityException>
        </ns2:EntityDisposition>
      </ns2:PayloadDisposition>
    </ns3:openPositionResponse>
  </S:Body>
</S:Envelope>
`;

/** `ack-warning-only.xml` */
export const ACK_WARNING_ONLY = `<?xml version="1.0" ?>
<S:Envelope xmlns:S="http://schemas.xmlsoap.org/soap/envelope/">
  <S:Body>
    <ns3:openPositionResponse xmlns:ns2="http://ns.hr-xml.org/2006-02-28" xmlns:ns3="http://adep.apec.fr/hrxml/sep">
      <ns2:PayloadResponseSummary>
        <ns2:UniquePayloadTrackingId idOwner="CLIENT">
          <ns2:IdValue>orqa-CAMP-2026-301-1757000112233</ns2:IdValue>
        </ns2:UniquePayloadTrackingId>
      </ns2:PayloadResponseSummary>
      <ns2:PayloadDisposition>
        <ns2:EntityDisposition>
          <ns2:EntityShortName>Position opening</ns2:EntityShortName>
          <ns2:EntityInstanceXPath>/PositionOpening</ns2:EntityInstanceXPath>
          <ns2:EntityException>
            <ns2:Exception>
              <ns2:ExceptionIdentifier>409</ns2:ExceptionIdentifier>
              <ns2:ExceptionSeverity>Warning</ns2:ExceptionSeverity>
              <ns2:ExceptionMessage>API_409_INVALID_PRESENTATION_DESCRIPTION_ERROR</ns2:ExceptionMessage>
            </ns2:Exception>
            <ns2:Exception>
              <ns2:ExceptionSeverity>Informational</ns2:ExceptionSeverity>
              <ns2:ExceptionMessage>API_411_INVALID_URL_VIDEO_ERROR</ns2:ExceptionMessage>
            </ns2:Exception>
          </ns2:EntityException>
        </ns2:EntityDisposition>
      </ns2:PayloadDisposition>
      <ns3:apecPositionNumero>177596708W</ns3:apecPositionNumero>
    </ns3:openPositionResponse>
  </S:Body>
</S:Envelope>
`;

/** `soap-fault.xml` */
export const SOAP_FAULT = `<?xml version="1.0" ?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <soap:Fault>
      <faultcode>soap:Server</faultcode>
      <faultstring>API_023_VALIDATION_XML_ERROR</faultstring>
    </soap:Fault>
  </soap:Body>
</soap:Envelope>
`;

/** Table nom de fichier → contenu, pour la garde d'anti-divergence. */
export const RECORDED_ACKS: Record<string, string> = {
  'ack-fatal-330.xml': ACK_FATAL_330,
  'ack-fatal-390.xml': ACK_FATAL_390,
  'ack-warning-only.xml': ACK_WARNING_ONLY,
  'soap-fault.xml': SOAP_FAULT,
};
