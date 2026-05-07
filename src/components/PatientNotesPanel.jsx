import React, { useEffect, useMemo, useState } from 'react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { db } from '../firebase';

const NOTES_LIMIT = 40;

function formatNoteTime(value) {
  if (!value) return 'Draft';
  const nextValue = typeof value?.toDate === 'function' ? value.toDate() : new Date(value);
  return Number.isNaN(nextValue.getTime()) ? 'Draft' : nextValue.toLocaleString();
}

export default function PatientNotesPanel({ patientId, currentUser }) {
  const [notes, setNotes] = useState([]);
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState('');
  const [editingBody, setEditingBody] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!patientId) {
      setNotes([]);
      return undefined;
    }

    const notesQuery = query(
      collection(db, 'users', patientId, 'crc_notes'),
      orderBy('updated_at', 'desc'),
      limit(NOTES_LIMIT)
    );

    const unsubscribe = onSnapshot(notesQuery, (snapshot) => {
      setNotes(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
    });

    return () => unsubscribe();
  }, [patientId]);

  const canCreate = draft.trim().length > 0 && !isSaving;

  const activeEditingNote = useMemo(
    () => notes.find((note) => note.id === editingId) || null,
    [editingId, notes]
  );

  const handleCreate = async (event) => {
    event.preventDefault();
    if (!patientId || !draft.trim() || isSaving) return;

    setIsSaving(true);
    try {
      await addDoc(collection(db, 'users', patientId, 'crc_notes'), {
        body: draft.trim(),
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
        created_by_uid: currentUser.uid,
        created_by_name: currentUser.name,
      });
      setDraft('');
    } catch (error) {
      window.alert(`Unable to save note: ${error.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!patientId || !editingId || !editingBody.trim() || isSaving) return;

    setIsSaving(true);
    try {
      await updateDoc(doc(db, 'users', patientId, 'crc_notes', editingId), {
        body: editingBody.trim(),
        updated_at: serverTimestamp(),
      });
      setEditingId('');
      setEditingBody('');
    } catch (error) {
      window.alert(`Unable to update note: ${error.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (noteId) => {
    if (!patientId) return;
    if (!window.confirm('Delete this CRC note?')) return;

    try {
      await deleteDoc(doc(db, 'users', patientId, 'crc_notes', noteId));
      if (editingId === noteId) {
        setEditingId('');
        setEditingBody('');
      }
    } catch (error) {
      window.alert(`Unable to delete note: ${error.message}`);
    }
  };

  return (
    <div className="patient-tabPanel patient-notes">
      <div className="patient-tabPanel__header">
        <div>
          <h4>CRC Notes</h4>
          <div className="section-note">
            Short CRC-only notes linked to the selected patient. These notes stay inside the CRC website and are not shown in the patient app.
          </div>
        </div>
        <span className="metric-pill">{notes.length} recent</span>
      </div>

      <form className="patient-notes__composer" onSubmit={handleCreate}>
        <textarea
          rows={4}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Add a CRC-only note about follow-up, trial coordination, or context that should stay with this patient."
        />
        <div className="patient-notes__composerFooter">
          <span className="section-note">Visible to CRC staff only.</span>
          <button type="submit" className="btn btn-primary" disabled={!canCreate}>
            {isSaving ? 'Saving...' : 'Add note'}
          </button>
        </div>
      </form>

      <div className="patient-notes__list">
        {notes.length ? (
          notes.map((note) => {
            const isEditing = editingId === note.id;
            return (
              <div key={note.id} className="patient-notes__item">
                <div className="patient-notes__meta">
                  <strong>{note.created_by_name || 'CRC staff'}</strong>
                  <span>{formatNoteTime(note.updated_at || note.created_at)}</span>
                </div>
                {isEditing ? (
                  <>
                    <textarea
                      rows={4}
                      value={editingBody}
                      onChange={(event) => setEditingBody(event.target.value)}
                    />
                    <div className="patient-notes__itemActions">
                      <button type="button" className="btn btn-secondary btn-small" onClick={() => {
                        setEditingId('');
                        setEditingBody('');
                      }}>
                        Cancel
                      </button>
                      <button type="button" className="btn btn-primary btn-small" onClick={handleSaveEdit} disabled={!editingBody.trim() || isSaving}>
                        Save
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="patient-notes__body">{note.body}</div>
                    <div className="patient-notes__itemActions">
                      <button
                        type="button"
                        className="btn btn-secondary btn-small"
                        onClick={() => {
                          setEditingId(note.id);
                          setEditingBody(note.body || '');
                        }}
                      >
                        Edit
                      </button>
                      <button type="button" className="btn btn-danger btn-small" onClick={() => handleDelete(note.id)}>
                        Delete
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })
        ) : (
          <div className="empty-panel">No CRC notes have been added for this patient yet.</div>
        )}
      </div>

      {activeEditingNote ? (
        <div className="section-note">
          Editing note created by {activeEditingNote.created_by_name || 'CRC staff'}.
        </div>
      ) : null}
    </div>
  );
}

