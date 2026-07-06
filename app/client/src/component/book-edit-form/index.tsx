import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Card } from '~/component/card';
import { CoverImagePicker } from '~/component/cover-image-picker';
import {
  Button,
  FieldList,
  NumberInput,
  Select,
  SubjectChips,
  Switch,
  TextArea,
  TextInput,
} from '~/control';
import type { FieldRow } from '~/control';
import type { Book } from '~/provider/book';
import { usePatchBookMetadata, useLibrarySubjects, useSeriesNames } from '~/provider/book';
import { useToast } from '~/provider/toast';
import { path } from '~/router';
import { areObjectArraysIdentical, areStringArraysIdentical, generateUUID } from '~/utils';

import { useStyle } from './style';

type IdentifierRow = { _key: string; scheme: string; value: string };

type Props = { original: Book; id: string };

export const BookEditForm = ({ original, id }: Props) => {
  const navigate = useNavigate();
  const styles = useStyle();

  const [isEditValid, setIsEditValid] = useState<Record<string, boolean>>({});
  const handleIsValidChange = useCallback((fieldName: string, newValid: boolean) => {
    setIsEditValid((previous) => ({ ...previous, [fieldName]: newValid }));
  }, []);

  const [patchBookMetadata, saving, saveError, saveErrorMessage] = usePatchBookMetadata();
  const [librarySubjects] = useLibrarySubjects();
  const [seriesOptions, seriesLoading] = useSeriesNames();

  const showToast = useToast();
  // Surface save failures the same way the page surfaces load failures. Without
  // this the 4xx/5xx body was discarded and handleSave navigated away anyway,
  // so a failed edit looked like a silent no-op.
  useEffect(() => {
    if (saveError) {
      showToast(saveErrorMessage ?? 'Failed to save changes.', 'error');
    }
  }, [saveError, saveErrorMessage, showToast]);

  const [cover, setCover] = useState<File | undefined>(undefined);

  const [title, setTitle] = useState<string | undefined>(original.title);
  const handleTitleChange = useCallback((newTitle: string | undefined) => {
    setTitle(newTitle);
  }, []);

  const [author, setAuthor] = useState<string | undefined>(original.author);
  const handleAuthorChange = useCallback((newAuthor: string | undefined) => {
    setAuthor(newAuthor);
  }, []);

  const [titleSort, setTitleSort] = useState<string | undefined>(original.titleSort);
  const handleTitleSortChange = useCallback((newTitleSort: string | undefined) => {
    setTitleSort(newTitleSort);
  }, []);

  const [authorSort, setAuthorSort] = useState<string | undefined>(original.authorSort);
  const handleAuthorSortChange = useCallback((newAuthorSort: string | undefined) => {
    setAuthorSort(newAuthorSort);
  }, []);

  const [publishDate, setPublishDate] = useState<string | undefined>(original.publishDate);
  const handlePublishDateChange = useCallback((newPublishDate: string | undefined) => {
    setPublishDate(newPublishDate);
  }, []);

  const [publisher, setPublisher] = useState<string | undefined>(original.publisher);
  const handlePublisherChange = useCallback((newPublisher: string | undefined) => {
    setPublisher(newPublisher);
  }, []);

  const [isSeries, setIsSeries] = useState<boolean>(!!original.series);
  const handleIsSeriesChange = useCallback((newIsSeries: boolean) => {
    setIsSeries(newIsSeries);
  }, []);

  const [series, setSeries] = useState<string | undefined>(original.series);
  const handleSeriesChange = useCallback((newSeries: string | undefined) => {
    setSeries(newSeries);
  }, []);

  const [seriesIndex, setSeriesIndex] = useState<number | undefined>(original.seriesIndex);
  const handleSeriesIndexChange = useCallback((index: number | undefined) => {
    setSeriesIndex(index);
  }, []);

  const [description, setDescription] = useState<string | undefined>(original.description ?? '');
  const handleDescriptionChange = useCallback((newDescription: string | undefined) => {
    setDescription(newDescription);
  }, []);

  const [subjects, setSubjects] = useState<string[]>(original.subjects);

  const [identifiers, setIdentifiers] = useState<IdentifierRow[]>(() =>
    original.identifiers.map((identifier) => ({
      scheme: identifier.scheme,
      value: identifier.value,
      _key: generateUUID(),
    }))
  );

  async function handleSave() {
    const newSubjects = subjects;
    const newIdentifiers = identifiers.map((row) => ({ scheme: row.scheme, value: row.value }));
    const originalSeriesIndex = original.seriesIndex !== 0 ? String(original.seriesIndex) : '';

    const newId = await patchBookMetadata(id, {
      cover,
      author: author && author.trim() !== original.author ? author.trim() : undefined,
      title: title && title.trim() !== original.title ? title.trim() : undefined,
      titleSort:
        titleSort !== undefined && titleSort.trim() !== (original.titleSort ?? '')
          ? titleSort.trim()
          : undefined,
      authorSort:
        authorSort !== undefined && authorSort.trim() !== (original.authorSort ?? '')
          ? authorSort.trim()
          : undefined,
      publishDate:
        (publishDate ?? '') !== (original.publishDate ?? '') ? (publishDate ?? '') : undefined,
      publisher:
        publisher && publisher.trim() !== original.publisher ? publisher.trim() : undefined,
      series: series && series.trim() !== original.series ? series.trim() : undefined,
      seriesIndex:
        seriesIndex && seriesIndex.toString() !== originalSeriesIndex ? seriesIndex : undefined,
      description:
        description && description.trim() !== (original.description ?? '')
          ? description.trim()
          : undefined,
      subjects: !areStringArraysIdentical(newSubjects, original.subjects) ? newSubjects : undefined,
      identifiers: !areObjectArraysIdentical(newIdentifiers, original.identifiers)
        ? newIdentifiers
        : undefined,
    });
    // A failed save returns undefined (the effect above shows why); stay on the
    // form so the user can retry rather than navigating away as if it worked.
    if (newId === undefined) return;
    navigate(path.book(newId));
  }

  return (
    <>
      <h1 className={styles.heading}>Edit Metadata — {original.title}</h1>

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
        headerAction={<Switch name="isSeries" checked={isSeries} onChange={handleIsSeriesChange} />}
        allowOverflow
      >
        {isSeries && (
          <div className={styles.cardContainer}>
            <Select
              value={series}
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

      <Card title="Subjects" allowOverflow>
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
            setIdentifiers((prev) => prev.map((r) => (r._key === key ? { ...r, [field]: val } : r)))
          }
          onValidChange={handleIsValidChange}
        />
      </Card>

      <div className={styles.buttonContainer}>
        <div className={styles.spacer} />
        <Button disabled={saving} onClick={() => navigate(path.book(id))}>
          Cancel
        </Button>
        <Button
          type="primary"
          disabled={Object.values(isEditValid).some((valid) => !valid)}
          onClick={() => void handleSave()}
          loading={saving}
        >
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </>
  );
};
