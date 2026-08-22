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
import type { BookEditBook } from '~/provider/book';
import {
  useUpdateBookMetadata,
  useLibrarySubjects,
  useSeriesNames,
  useFetchSeriesNextIndex,
} from '~/provider/book';
import { useToast } from '~/provider/toast';
import { path } from '~/router';
import { areObjectArraysIdentical, areStringArraysIdentical, generateUUID } from '~/utils';

import { useStyle } from './style';

type IdentifierRow = { _key: string; scheme: string; value: string };

type Props = {
  book: BookEditBook;
};

export const BookEditForm = ({ book }: Props) => {
  const navigate = useNavigate();
  const styles = useStyle();
  // Unique id ties the footer-slot Save action to this form by construction,
  // robust against any future co-mounting.
  const formId = useId();

  const [isEditValid, setIsEditValid] = useState<Record<string, boolean>>({});
  const handleIsValidChange = useCallback((fieldName: string, newValid: boolean) => {
    setIsEditValid((previous) => ({ ...previous, [fieldName]: newValid }));
  }, []);

  const [updateBookMetadata, , saveErrorMessage] = useUpdateBookMetadata();
  const [librarySubjects] = useLibrarySubjects();
  const [seriesOptions, seriesLoading] = useSeriesNames();

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

  const fetchSeriesNextIndex = useFetchSeriesNextIndex();
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
