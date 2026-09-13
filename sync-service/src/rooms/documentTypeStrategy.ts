import type * as Y from "yjs";
import type { DocumentType } from "../auth/collabToken.js";
import { getShapesMap } from "./shapes.js";

/**
 * A version restore (Section 7) needs to know how to replace a room's *live* content
 * with a restored snapshot's content — and that depends on which shared Yjs type the
 * document uses (Y.Text for DOCUMENT, Y.Map for WHITEBOARD). This used to be a single
 * if/else in restoreLiveRoom; it's genuine polymorphism instead now — a strategy per
 * document type, resolved once by getDocumentTypeStrategy, so adding a third document
 * type later means adding a new strategy, not editing an existing branch.
 */
export interface DocumentTypeStrategy {
  replaceWithRestoredState(liveDoc: Y.Doc, restoredDoc: Y.Doc): void;
}

class TextDocumentStrategy implements DocumentTypeStrategy {
  replaceWithRestoredState(liveDoc: Y.Doc, restoredDoc: Y.Doc): void {
    const restoredText = restoredDoc.getText("body").toString();
    const text = liveDoc.getText("body");
    text.delete(0, text.length);
    text.insert(0, restoredText);
  }
}

class WhiteboardDocumentStrategy implements DocumentTypeStrategy {
  replaceWithRestoredState(liveDoc: Y.Doc, restoredDoc: Y.Doc): void {
    const restoredShapes = getShapesMap(restoredDoc);
    const shapes = getShapesMap(liveDoc);
    shapes.clear();
    restoredShapes.forEach((shape, id) => shapes.set(id, shape));
  }
}

const STRATEGIES: Record<DocumentType, DocumentTypeStrategy> = {
  DOCUMENT: new TextDocumentStrategy(),
  WHITEBOARD: new WhiteboardDocumentStrategy(),
};

export function getDocumentTypeStrategy(documentType: DocumentType): DocumentTypeStrategy {
  return STRATEGIES[documentType];
}
