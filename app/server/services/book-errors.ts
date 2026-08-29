export class BookHashCollisionError extends Error {
  constructor(public readonly collidingId: string) {
    super(`Book hash collision: edited content matches existing book "${collidingId}"`);
    this.name = 'BookHashCollisionError';
  }
}

export class BookAlreadyExistsError extends Error {
  constructor(public readonly existingId: string) {
    super(`Book with id "${existingId}" already exists in the library`);
    this.name = 'BookAlreadyExistsError';
  }
}

export class SelfLinkError extends Error {
  constructor() {
    super('Cannot link a document ID to itself');
    this.name = 'SelfLinkError';
  }
}

export class DocumentAlreadyLinkedError extends Error {
  constructor(public readonly documentId: string) {
    super(`Document "${documentId}" is already linked to a book`);
    this.name = 'DocumentAlreadyLinkedError';
  }
}

export class DocumentIsBookError extends Error {
  constructor(public readonly documentId: string) {
    super(`Document "${documentId}" is an existing book — use the book's lineage to link instead`);
    this.name = 'DocumentIsBookError';
  }
}
