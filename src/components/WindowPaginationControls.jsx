import React from 'react';

const DEFAULT_PAGE_SIZE_OPTIONS = [10, 20, 30, 50, 100];

export default function WindowPaginationControls({
  page = 1,
  pageSize = 30,
  onPageChange,
  onPageSizeChange,
  canGoNext = false,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  note = '',
  hideNote = false,
}) {
  return (
    <div className="section-header history-pagination">
      <div className="section-note">
        {hideNote
          ? null
          : note || (
              <>
                Page <strong>{page}</strong>
              </>
            )}
      </div>
      <div className="history-pagination__controls">
        <select
          value={pageSize}
          onChange={(event) => onPageSizeChange?.(Number(event.target.value))}
          style={{ width: '100px' }}
        >
          {pageSizeOptions.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <button
          className="btn btn-secondary btn-small"
          disabled={page <= 1}
          onClick={() => onPageChange?.(Math.max(page - 1, 1))}
        >
          Prev
        </button>
        <button
          className="btn btn-secondary btn-small"
          disabled={!canGoNext}
          onClick={() => onPageChange?.(page + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}
