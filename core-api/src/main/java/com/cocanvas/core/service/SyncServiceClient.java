package com.cocanvas.core.service;

import com.cocanvas.core.config.InternalProperties;
import com.cocanvas.core.config.SyncServiceProperties;
import com.cocanvas.core.security.CorrelationIdFilter;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Base64;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.stereotype.Service;

/**
 * The one call that runs in the direction opposite every other cross-service call in this system:
 * the Core API reaching into the sync service, instead of the other way around. Used only to push a
 * restored version into a document's live in-memory session (Section 7's restore endpoint) so
 * people currently in the document see the restore immediately rather than only on their next
 * reconnect.
 *
 * <p>Best-effort by design: the Postgres write in VersionService is the actual source of truth for
 * the restore, so a sync service that's unreachable or has no live session for this document must
 * never fail the request — it only means nobody happens to be live in it right now.
 */
@Service
public class SyncServiceClient {

  private static final Logger log = LoggerFactory.getLogger(SyncServiceClient.class);

  private final HttpClient httpClient =
      HttpClient.newBuilder()
          // The sync service's plain node:http server only speaks HTTP/1.1 — without
          // this, the JDK client's default HTTP/2-with-upgrade negotiation gets no
          // response at all (observed as "received no bytes") rather than falling
          // back cleanly.
          .version(HttpClient.Version.HTTP_1_1)
          .connectTimeout(Duration.ofSeconds(2))
          .build();

  private final SyncServiceProperties syncServiceProperties;
  private final InternalProperties internalProperties;

  public SyncServiceClient(
      SyncServiceProperties syncServiceProperties, InternalProperties internalProperties) {
    this.syncServiceProperties = syncServiceProperties;
    this.internalProperties = internalProperties;
  }

  public void pushRestoredState(UUID documentId, byte[] yjsState) {
    String base64State = Base64.getEncoder().encodeToString(yjsState);
    String body = "{\"state\":\"" + base64State + "\"}";

    HttpRequest.Builder requestBuilder =
        HttpRequest.newBuilder()
            .uri(
                URI.create(
                    syncServiceProperties.internalUrl()
                        + "/internal/documents/"
                        + documentId
                        + "/restore"))
            .header("Content-Type", "application/json")
            .header("X-Internal-Secret", internalProperties.syncServiceSecret())
            .timeout(Duration.ofSeconds(3))
            .POST(HttpRequest.BodyPublishers.ofString(body));

    // Carries this request's correlation ID (Section 12) into the sync service's own
    // structured logs, so a restore can be traced end-to-end across both services.
    String correlationId = MDC.get(CorrelationIdFilter.MDC_KEY);
    if (correlationId != null) {
      requestBuilder.header(CorrelationIdFilter.HEADER, correlationId);
    }
    HttpRequest request = requestBuilder.build();

    try {
      HttpResponse<Void> response =
          httpClient.send(request, HttpResponse.BodyHandlers.discarding());
      if (response.statusCode() != 200) {
        log.warn(
            "Sync service rejected restore push for document {}: HTTP {}",
            documentId,
            response.statusCode());
      }
    } catch (Exception e) {
      log.warn(
          "Could not reach sync service to push restore for document {} — the persisted state was still "
              + "updated, so this only affects anyone currently live in the document: {}",
          documentId,
          e.getMessage());
    }
  }
}
