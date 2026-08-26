import { useLazyQuery, useMutation, useQuery } from '@apollo/client/react';
import { useActionState, useCallback, useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router';

import { Card } from '~/component/card';
import { CoverImagePicker } from '~/component/cover-image-picker';
import {
  FieldList,
  NumberInput,
  PageFooterActions,
  Select,
  SubjectChips,
  Switch,
  TextArea,
  TextInput,
} from '~/control';
import type { FieldRow } from '~/control';
import { graphql, useFragment, type FragmentType } from '~/gql';
import type { BookUpdateMetadataMutation } from '~/gql/graphql';
import { BookUpdateMetadataDocument } from '~/graphql/book-edit';
import {
  LibrarySubjectsDocument,
  SeriesNamesDocument,
  SeriesNextIndexDocument,
} from '~/graphql/library';
import { stageUpload } from '~/lib/staged-upload';
import { unwrapResult } from '~/provider/apollo';
import { useCurrentLibraryId } from '~/provider/library-target';
import { useToast } from '~/provider/toast';
import { path } from '~/router';
import { areObjectArraysIdentical, areStringArraysIdentical, generateUUID } from '~/utils';

import { useStyle } from './style';

/**
 * Colocated: exactly the fields this form renders, and nothing else.
 * `page/book-edit` composes it into `BookEditDocument` — the spread is
 * resolved by NAME by codegen, so this fragment stays owned here regardless
 * of which module holds the document.
 *
 * Replaces the hand-written `BookEditBook` type that used to live in
 * `provider/book/hook/use-book-edit.ts` and mirror this selection by hand.
 * The generated fragment type is now the only description of the shape, so
 * it cannot drift from the document the way a hand-maintained mirror can.
 *
 * **`documentId` is deliberately absent.** It was selected by `BookEdit`
 * before Task 8 and read by nothing: `handleSave` navigates on the MUTATION
 * payload's `id`, and Cancel navigates on `book.id`. Removing it is 1 breadth
 * off every visit to this route.
 *
 * `id` is here because this form addresses the book with it twice — Cancel's
 * `path.book(book.id)` and `bookUpdateMetadata`'s input — and it is the key
 * that makes the mutation payload normalize back onto the same cache entity
 * this fragment was read from.
 */
export const BookEditFormFragment = graphql(`
  fragment BookEditFormFragment on Book {
    id
    title
    titleSort
    author
    authorSort
    description
    publisher
    publishDate
    seriesIndex
    subjects
    series {
      id
      name
    }
    identifiers {
      scheme
      value
    }
  }
`);

// `unwrapResult`'s `TPayload` sits in a position TypeScript cannot infer from
// the call, so it is named explicitly here, extracted from the generated
// union rather than hand-duplicated.
type BookUpdateMetadataPayload = Extract<
  NonNullable<BookUpdateMetadataMutation['bookUpdateMetadata']>,
  { __typename: 'BookUpdateMetadataPayload' }
>;

/** The save patch. Every field is optional because `handleSave` sends
 * `undefined` for every UNCHANGED field. */
type BookEditPatch = Partial<{
  title: string;
  titleSort: string;
  author: string;
  authorSort: string;
  description: string;
  publisher: string;
  publishDate: string;
  series: string;
  seriesIndex: number;
  subjects: string[];
  identifiers: { scheme: string; value: string }[];
  cover: File;
}>;

type IdentifierRow = { _key: string; scheme: string; value: string };

type Props = {
  book: FragmentType<typeof BookEditFormFragment>;
};

export const BookEditForm = ({ book: bookRef }: Props) => {
  // Exactly one `useFragment`, unconditional, at the top of the body — the
  // discipline every colocated component in this repo follows. It is an
  // identity cast today (masking is compile-time only until the final step),
  // but it is placed as if it were a real hook.
  const book = useFragment(BookEditFormFragment, bookRef);
  const navigate = useNavigate();
  const styles = useStyle();
  // Unique id ties the footer-slot Save action to this form by construction,
  // robust against any future co-mounting.
  const formId = useId();

  const [isEditValid, setIsEditValid] = useState<Record<string, boolean>>({});
  const handleIsValidChange = useCallback((fieldName: string, newValid: boolean) => {
    setIsEditValid((previous) => ({ ...previous, [fieldName]: newValid }));
  }, []);

  /**
   * The form's own reads and its save, inlined at the call site now that
   * `provider/book` is gone. All three reads root on `node(id: $libraryId)`
   * — the only single root that serves both a non-admin's own library and an
   * admin's selected one — so each is SKIPPED until `useCurrentLibraryId`
   * resolves, and `seriesLoading` folds that bootstrap round trip in: a
   * skipped `useQuery` reports `loading: false` on its own, which would show
   * the series Select as "loaded and empty" for the whole `ViewerBootstrap`
   * window (a false "no series yet", not a corner case).
   *
   * Neither read surfaces an error to the user, matching the hooks they
   * replace: subjects and series names are optional editing *candidates*, so
   * a failure degrades to "no suggestions offered" rather than an error
   * state on a form whose real content loaded fine.
   */
  const { libraryId, loading: libraryIdLoading } = useCurrentLibraryId();
  const libraryVariables = { libraryId: libraryId ?? '' };
  const skipLibraryRead = libraryId === undefined;

  const { data: subjectsData } = useQuery(LibrarySubjectsDocument, {
    variables: libraryVariables,
    skip: skipLibraryRead,
  });
  const librarySubjects =
    subjectsData?.node?.__typename === 'Library' ? subjectsData.node.subjects : [];

  const { data: seriesData, loading: seriesQueryLoading } = useQuery(SeriesNamesDocument, {
    variables: libraryVariables,
    skip: skipLibraryRead,
  });
  // Ordered as `Library.series` returns them — the server-computed sort key
  // that strips leading articles ("the", "a", "an") already lives server-side,
  // so this maps without reordering.
  const seriesOptions =
    seriesData?.node?.__typename === 'Library' ? seriesData.node.series.map((x) => x.name) : [];
  const seriesLoading = seriesQueryLoading || libraryIdLoading;

  const [runUpdate] = useMutation(BookUpdateMetadataDocument);
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | undefined>();

  const showToast = useToast();
  // Surface save failures the same way the page surfaces load failures. Without
  // this the failure was discarded and handleSave navigated away anyway, so a
  // failed edit looked like a silent no-op.
  useEffect(() => {
    if (saveErrorMessage !== undefined) {
      showToast(saveErrorMessage, 'error');
    }
  }, [saveErrorMessage, showToast]);

  const [cover, setCover] = useState<File | undefined>(undefined);

  const [title, setTitle] = useState<string | undefined>(book.title);
  const handleTitleChange = useCallback((newTitle: string | undefined) => {
    setTitle(newTitle);
  }, []);

  const [author, setAuthor] = useState<string | undefined>(book.author);
  const handleAuthorChange = useCallback((newAuthor: string | undefined) => {
    setAuthor(newAuthor);
  }, []);

  const [titleSort, setTitleSort] = useState<string | undefined>(book.titleSort);
  const handleTitleSortChange = useCallback((newTitleSort: string | undefined) => {
    setTitleSort(newTitleSort);
  }, []);

  const [authorSort, setAuthorSort] = useState<string | undefined>(book.authorSort);
  const handleAuthorSortChange = useCallback((newAuthorSort: string | undefined) => {
    setAuthorSort(newAuthorSort);
  }, []);

  const [publishDate, setPublishDate] = useState<string | undefined>(book.publishDate);
  const handlePublishDateChange = useCallback((newPublishDate: string | undefined) => {
    setPublishDate(newPublishDate);
  }, []);

  const [publisher, setPublisher] = useState<string | undefined>(book.publisher);
  const handlePublisherChange = useCallback((newPublisher: string | undefined) => {
    setPublisher(newPublisher);
  }, []);

  const [isSeries, setIsSeries] = useState<boolean>(!!book.series);
  const handleIsSeriesChange = useCallback((newIsSeries: boolean) => {
    setIsSeries(newIsSeries);
  }, []);

  /**
   * `Library.seriesNextIndex(name:)`, fired ON DEMAND from `handleSeriesChange`
   * the moment the user picks a series — never on mount, which is why this is
   * `useLazyQuery`.
   *
   * The variables are passed EXPLICITLY on every call, not left to the
   * hook-level default. Apollo's `useLazyQuery` execute function resets to
   * EMPTY variables when called with no arguments ("If `variables` is not
   * given, reset back to empty variables"), so omitting them would send
   * `SeriesNextIndex` with `{}`.
   *
   * Rejects on failure rather than reporting an error: the caller below
   * already has its own stale-response guard and simply leaves Order empty.
   */
  const [executeNextIndex] = useLazyQuery(SeriesNextIndexDocument);
  const fetchSeriesNextIndex = useCallback(
    async (name: string): Promise<number> => {
      const { data } = await executeNextIndex({ variables: { libraryId: libraryId ?? '', name } });
      const node = data?.node;
      if (node?.__typename !== 'Library') {
        throw new Error('Failed to fetch next series index');
      }
      return node.seriesNextIndex;
    },
    [executeNextIndex, libraryId]
  );
  const seriesRequestRef = useRef<string | undefined>(undefined);

  // `book.series` is a `Series` object (`{ id, name }`) or `null`, not a bare
  // string — the `series` state, the diff below, and `isSeries` above all
  // read `.name` off it rather than treating it as the string itself.
  const [series, setSeries] = useState<string | undefined>(book.series?.name);
  const [seriesIndex, setSeriesIndex] = useState<number | undefined>(book.seriesIndex);

  const handleSeriesChange = useCallback(
    (newSeries: string | undefined) => {
      setSeries(newSeries);
      const trimmed = newSeries?.trim();
      seriesRequestRef.current = trimmed;
      if (!trimmed) return;
      // Only auto-fill when Order is empty (undefined or the "no value" 0).
      if (seriesIndex !== undefined && seriesIndex !== 0) return;
      void fetchSeriesNextIndex(trimmed)
        .then((nextIndex) => {
          // Ignore a stale response if the user changed the series meanwhile,
          // and never clobber an Order the user entered while the fetch was in flight.
          if (seriesRequestRef.current !== trimmed) return;
          setSeriesIndex((current) =>
            current === undefined || current === 0 ? nextIndex : current
          );
        })
        .catch(() => {
          // Leave Order empty on failure.
        });
    },
    [seriesIndex, fetchSeriesNextIndex]
  );

  const handleSeriesIndexChange = useCallback((index: number | undefined) => {
    setSeriesIndex(index);
  }, []);

  const [description, setDescription] = useState<string>(book.description);
  const handleDescriptionChange = useCallback((newDescription: string | undefined) => {
    setDescription(newDescription ?? '');
  }, []);

  const [subjects, setSubjects] = useState<string[]>(book.subjects);

  const [identifiers, setIdentifiers] = useState<IdentifierRow[]>(() =>
    book.identifiers.map((identifier) => ({
      scheme: identifier.scheme,
      value: identifier.value,
      _key: generateUUID(),
    }))
  );

  /**
   * Save, in two phases, because file bytes have no transport in GraphQL: a
   * changed cover is staged over the permanent REST seam
   * (`~/lib/staged-upload`) FIRST, and only the id it resolves rides into
   * `bookUpdateMetadata`'s `stagedCoverId`. If `patch.cover` is unset,
   * `stageUpload` is never called; if staging throws, this returns with a
   * COVER-specific message and the mutation never fires. That is why the two
   * phases report two different user-facing messages where the REST-era
   * single multipart PATCH could only ever report one.
   *
   * The staged upload's own 30-minute TTL and one-time consume clean up a
   * cover staged for a mutation that then failed, so there is no client-side
   * compensation to write here.
   *
   * **No `if (saving) return` re-entrancy guard**, unlike the tuple-shaped
   * hook this replaces. At THIS call site the guard was unreachable and
   * therefore untestable: `useActionState` serializes submissions, and
   * `Button` in submit mode renders `disabled={disabled || busy}` — so the
   * Save button is a genuinely disabled native `<button>` for the whole
   * in-flight window, which also blocks implicit (Enter-key) submission.
   * Shipping an unreachable guard alongside a test that could not fail is
   * exactly the defect this project keeps producing, so the protection is
   * pinned where it actually lives: "does not send a second request while the
   * first is still in flight" counts mutation requests at `MockLink.request()`
   * time and goes red the moment `loading: isPending` is dropped from the Save
   * action below.
   *
   * `update` does TWO things, both carried over verbatim from the
   * `useUpdateBookMetadata` hook this replaces:
   *
   *   1. Evicts the current library's ENTIRE `Library.entries` field —
   *      UNCONDITIONALLY, every successful save, not gated on the id
   *      changing. `entries` is `relayStylePagination(['filter'])` and
   *      `page/library` reads it cache-first with nothing refetching on
   *      navigation, so a stale row silently persisted in the grid until a
   *      hard reload. It is not merely an id-rotation problem: a
   *      title/author/series edit moves the row's sort position or series
   *      grouping — exactly what `BookRowFragment` renders — even when the id
   *      holds. The library id comes from `useCurrentLibraryId()`, not the
   *      payload: `BookUpdateMetadataPayload` carries no `library { id }` the
   *      way `BookDeletePayload` does. Not free — it discards every page
   *      `fetchMore` had accumulated, so a user deep in the grid resumes at
   *      page 1.
   *
   *      **Not fixed by it**: `Library.series` (this form's own autocomplete)
   *      is a separate field with no pagination policy, so a save that mints
   *      a brand new series name leaves it stale until something else
   *      invalidates it. Unchanged from the hook; out of scope here too.
   *
   *   2. Evicts the STALE `Book:<bookId>` entity ONLY when the payload's
   *      `book.id` differs from the requested one. Editing metadata rewrites
   *      the EPUB (title page, cover), which changes its content hash, which
   *      is the raw local half of the Book's global id — so a save can mint a
   *      NEW id. When it does, normalization writes a brand new
   *      `Book:<new-id>` and cannot know the old entity described the same
   *      book. (Server resolver doc comment,
   *      `graphql/schema/book/mutation/update-metadata.ts`: "a client must
   *      evict it itself".)
   */
  const updateBookMetadata = useCallback(
    async (bookId: string, patch: BookEditPatch): Promise<{ id: string } | undefined> => {
      setSaveErrorMessage(undefined);

      try {
        const { cover: coverFile, ...rest } = patch;

        let stagedCoverId: string | undefined;
        if (coverFile !== undefined) {
          try {
            stagedCoverId = await stageUpload(coverFile, 'cover');
          } catch {
            // Deliberately NOT `err.message`: nothing guarantees the
            // underlying error mentions the cover (a raw network throw
            // wouldn't), and the whole point of this branch is that the user
            // can tell STAGING broke, not saving.
            setSaveErrorMessage("Couldn't upload the cover image");
            return undefined;
          }
        }

        const { data } = await runUpdate({
          variables: {
            input: {
              id: bookId,
              ...rest,
              ...(stagedCoverId !== undefined ? { stagedCoverId } : {}),
            },
          },
          update: (cache, { data: mutationData }) => {
            const outcome = unwrapResult<BookUpdateMetadataPayload>(
              mutationData?.bookUpdateMetadata,
              'BookUpdateMetadataPayload'
            );
            if (outcome.status !== 'ok') return;

            if (libraryId !== undefined) {
              cache.evict({
                id: cache.identify({ __typename: 'Library', id: libraryId }),
                fieldName: 'entries',
              });
            }

            if (outcome.payload.book.id !== bookId) {
              cache.evict({ id: cache.identify({ __typename: 'Book', id: bookId }) });
            }

            cache.gc();
          },
        });

        const result = unwrapResult<BookUpdateMetadataPayload>(
          data?.bookUpdateMetadata,
          'BookUpdateMetadataPayload'
        );
        if (result.status === 'missing') {
          setSaveErrorMessage("Couldn't save your changes");
          return undefined;
        }
        if (result.status === 'error') {
          setSaveErrorMessage(result.message);
          return undefined;
        }

        return { id: result.payload.book.id };
      } catch (err) {
        // ALWAYS sets a message, unlike some sibling mutations' catch-alls:
        // the failure toast below keys purely on
        // `saveErrorMessage !== undefined`, so leaving it unset for a
        // non-`Error` throw would make a failed save look like a silent no-op.
        setSaveErrorMessage(err instanceof Error ? err.message : "Couldn't save your changes");
        return undefined;
      }
    },
    [runUpdate, libraryId]
  );

  async function handleSave() {
    const newSubjects = subjects;
    const newIdentifiers = identifiers.map((row) => ({ scheme: row.scheme, value: row.value }));
    const originalSeriesName = book.series?.name;
    const originalSeriesIndex = book.seriesIndex !== 0 ? String(book.seriesIndex) : '';

    const patched = await updateBookMetadata(book.id, {
      cover,
      author: author && author.trim() !== book.author ? author.trim() : undefined,
      title: title && title.trim() !== book.title ? title.trim() : undefined,
      titleSort:
        titleSort !== undefined && titleSort.trim() !== book.titleSort
          ? titleSort.trim()
          : undefined,
      authorSort:
        authorSort !== undefined && authorSort.trim() !== book.authorSort
          ? authorSort.trim()
          : undefined,
      publishDate: (publishDate ?? '') !== book.publishDate ? (publishDate ?? '') : undefined,
      publisher: publisher && publisher.trim() !== book.publisher ? publisher.trim() : undefined,
      series: series && series.trim() !== originalSeriesName ? series.trim() : undefined,
      seriesIndex:
        seriesIndex && seriesIndex.toString() !== originalSeriesIndex ? seriesIndex : undefined,
      description:
        description && description.trim() !== book.description ? description.trim() : undefined,
      subjects: !areStringArraysIdentical(newSubjects, book.subjects) ? newSubjects : undefined,
      identifiers: !areObjectArraysIdentical(newIdentifiers, book.identifiers)
        ? newIdentifiers
        : undefined,
    });
    // A failed save returns undefined (the effect above shows why); stay on the
    // form so the user can retry rather than navigating away as if it worked.
    if (patched === undefined) return;
    // `.id` — the mutation payload's own `id` field, already a Relay GLOBAL
    // id (`graphql/book-edit.ts`'s `BookUpdateMetadataDocument`) — not
    // `.documentId` (the raw content hash): editing metadata rewrites the
    // EPUB file, changing its content hash and therefore the global id too,
    // so `page/book` (GraphQL) needs the NEW one, not the pre-save value.
    navigate(path.book(patched.id));
  }

  const [, submitAction, isPending] = useActionState(async () => {
    await handleSave();
    return null;
  }, null);

  return (
    <>
      <h1 className={styles.heading}>Edit Metadata — {book.title}</h1>

      <form id={formId} className={styles.form} action={submitAction}>
        <Card>
          <div className={styles.cardContainer}>
            <TextInput value={title} label="Title" name="title" onChange={handleTitleChange} />
            <TextInput
              value={titleSort}
              label="Title Sort"
              name="titleSort"
              onChange={handleTitleSortChange}
              onValidChange={handleIsValidChange}
              validate={(v) => !v || !/^(the |a |an )/i.test(v)}
            />
            <TextInput value={author} label="Author" name="author" onChange={handleAuthorChange} />
            <TextInput
              value={authorSort}
              label="Author Sort"
              name="authorSort"
              onChange={handleAuthorSortChange}
              onValidChange={handleIsValidChange}
              validate={(v) => !v || !v.includes(' ') || v.includes(',')}
            />
            <TextInput
              value={publisher}
              label="Publisher"
              name="publisher"
              onChange={handlePublisherChange}
            />
            <TextInput
              value={publishDate}
              label="Publish Date"
              name="publishDate"
              onChange={handlePublishDateChange}
              onValidChange={handleIsValidChange}
              validate={(v) =>
                !v ||
                /^\d{4}(-\d{2}(-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?)?)?$/.test(
                  v
                )
              }
            />
          </div>
        </Card>

        <CoverImagePicker value={cover} onChange={setCover} />

        <Card title="Description">
          <TextArea
            value={description}
            name="description"
            layout="vertical"
            onChange={handleDescriptionChange}
            maxLength={3000}
            autoResize
          />
        </Card>

        <Card
          title="Series"
          headerAction={
            <Switch name="isSeries" checked={isSeries} onChange={handleIsSeriesChange} />
          }
        >
          {isSeries && (
            <div className={styles.cardContainer}>
              <Select
                value={series || undefined}
                label="Name"
                name="seriesName"
                options={seriesOptions}
                onChange={handleSeriesChange}
                loading={seriesLoading}
                allowCreate
              />
              <NumberInput
                name="seriesIndex"
                value={seriesIndex}
                label="Order"
                onChange={handleSeriesIndexChange}
                onValidChange={handleIsValidChange}
              />
            </div>
          )}
        </Card>

        <Card title="Subjects">
          <SubjectChips value={subjects} suggestions={librarySubjects} onChange={setSubjects} />
        </Card>

        <Card title="Identifiers">
          <FieldList
            addLabel="Add identifier"
            columns={[
              { type: 'text', key: 'scheme', placeholder: 'Scheme (e.g. isbn)' },
              { type: 'text', key: 'value', placeholder: 'Value' },
            ]}
            rows={identifiers as FieldRow[]}
            onAdd={() =>
              setIdentifiers((prev) => [...prev, { _key: generateUUID(), scheme: '', value: '' }])
            }
            onRemove={(key) => setIdentifiers((prev) => prev.filter((r) => r._key !== key))}
            onChange={(key, field, val) =>
              setIdentifiers((prev) =>
                prev.map((r) => (r._key === key ? { ...r, [field]: val } : r))
              )
            }
            onValidChange={handleIsValidChange}
          />
        </Card>
      </form>

      <PageFooterActions
        items={[
          {
            label: 'Cancel',
            // `book.id` — the GraphQL book's own id field, already a Relay
            // GLOBAL id — not `documentId`: `page/book` (GraphQL) 404s on a
            // raw id. There's no longer a separate `bookGlobalId` prop; the
            // form's `book` IS the GraphQL book, so this is the only id it
            // needs.
            onClick: () => navigate(path.book(book.id)),
            disabled: isPending,
          },
          {
            label: isPending ? 'Saving…' : 'Save',
            onClick: () => {},
            submit: true,
            form: formId,
            disabled: Object.values(isEditValid).some((valid) => !valid),
            loading: isPending,
            emphasis: true,
          },
        ]}
      />
    </>
  );
};
