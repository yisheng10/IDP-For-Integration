import React, { useEffect, useState } from 'react';
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

const TASKS_LIMIT = 50;

function formatDueDate(value) {
  if (!value) return 'No due date';
  const nextValue = typeof value?.toDate === 'function' ? value.toDate() : new Date(value);
  return Number.isNaN(nextValue.getTime()) ? 'No due date' : nextValue.toLocaleString();
}

export default function PatientTasksPanel({ patientId, currentUser }) {
  const [tasks, setTasks] = useState([]);
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState('medium');
  const [dueAt, setDueAt] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!patientId) {
      setTasks([]);
      return undefined;
    }

    const tasksQuery = query(
      collection(db, 'users', patientId, 'crc_tasks'),
      orderBy('updated_at', 'desc'),
      limit(TASKS_LIMIT)
    );

    const unsubscribe = onSnapshot(tasksQuery, (snapshot) => {
      setTasks(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
    });

    return () => unsubscribe();
  }, [patientId]);

  const handleCreate = async (event) => {
    event.preventDefault();
    if (!patientId || !title.trim() || isSaving) return;

    setIsSaving(true);
    try {
      await addDoc(collection(db, 'users', patientId, 'crc_tasks'), {
        title: title.trim(),
        status: 'open',
        priority,
        due_at: dueAt ? new Date(dueAt).toISOString() : null,
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
        created_by_uid: currentUser.uid,
        created_by_name: currentUser.name,
      });
      setTitle('');
      setPriority('medium');
      setDueAt('');
    } catch (error) {
      window.alert(`Unable to create task: ${error.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const toggleTask = async (task) => {
    if (!patientId) return;
    try {
      await updateDoc(doc(db, 'users', patientId, 'crc_tasks', task.id), {
        status: task.status === 'done' ? 'open' : 'done',
        updated_at: serverTimestamp(),
      });
    } catch (error) {
      window.alert(`Unable to update task: ${error.message}`);
    }
  };

  const handleDelete = async (taskId) => {
    if (!patientId) return;
    if (!window.confirm('Delete this CRC task?')) return;

    try {
      await deleteDoc(doc(db, 'users', patientId, 'crc_tasks', taskId));
    } catch (error) {
      window.alert(`Unable to delete task: ${error.message}`);
    }
  };

  return (
    <div className="patient-tabPanel patient-tasks">
      <div className="patient-tabPanel__header">
        <div>
          <h4>CRC Tasks</h4>
          <div className="section-note">
            Lightweight manual tasks for the selected patient. These task items stay inside the CRC website and are not mirrored to the patient app.
          </div>
        </div>
        <span className="metric-pill">{tasks.filter((task) => task.status === 'open').length} open</span>
      </div>

      <form className="patient-tasks__composer" onSubmit={handleCreate}>
        <div className="patient-tasks__composerGrid">
          <input
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Add a CRC task for this patient"
          />
          <select value={priority} onChange={(event) => setPriority(event.target.value)}>
            <option value="low">Low priority</option>
            <option value="medium">Medium priority</option>
            <option value="high">High priority</option>
          </select>
          <input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} />
          <button type="submit" className="btn btn-primary" disabled={!title.trim() || isSaving}>
            {isSaving ? 'Saving...' : 'Add task'}
          </button>
        </div>
      </form>

      <div className="patient-tasks__list">
        {tasks.length ? (
          tasks.map((task) => (
            <div key={task.id} className={`patient-tasks__item ${task.status === 'done' ? 'patient-tasks__item--done' : ''}`}>
              <div className="patient-tasks__itemCopy">
                <div className="patient-tasks__titleRow">
                  <strong>{task.title}</strong>
                  <span className={`metric-pill metric-pill--${task.priority || 'default'}`}>
                    {String(task.priority || 'medium').toUpperCase()}
                  </span>
                </div>
                <div className="patient-tasks__meta">
                  <span>Status: {task.status === 'done' ? 'Done' : 'Open'}</span>
                  <span>Due: {formatDueDate(task.due_at)}</span>
                  <span>Owner: {task.created_by_name || 'CRC staff'}</span>
                </div>
              </div>
              <div className="patient-tasks__actions">
                <button type="button" className="btn btn-secondary btn-small" onClick={() => toggleTask(task)}>
                  {task.status === 'done' ? 'Reopen' : 'Mark done'}
                </button>
                <button type="button" className="btn btn-danger btn-small" onClick={() => handleDelete(task.id)}>
                  Delete
                </button>
              </div>
            </div>
          ))
        ) : (
          <div className="empty-panel">No CRC tasks are linked to this patient yet.</div>
        )}
      </div>
    </div>
  );
}

