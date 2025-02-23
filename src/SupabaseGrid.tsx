import './style.css';
import React from 'react';
import AwesomeDebouncePromise from 'awesome-debounce-promise';
import { createPortal } from 'react-dom';
import { useMonaco } from '@monaco-editor/react';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import {
  Dictionary,
  SupabaseGridProps,
  SupabaseGridRef,
  SupaTable,
} from './types';
import { DataGridHandle } from '@supabase/react-data-grid';
import { RowContextMenu } from './components/menu';
import { StoreProvider, useDispatch, useTrackedState } from './store';
import {
  fetchCount,
  fetchPage,
  getStorageKey,
  refreshPageDebounced,
} from './utils';
import {
  REFRESH_PAGE_IMMEDIATELY,
  STORAGE_KEY_PREFIX,
  TOTAL_ROWS_RESET,
} from './constants';
import { InitialStateType } from './store/reducers';
import { getGridColumns } from './utils/gridColumns';
import { Grid } from './components/grid';
import { Shortcuts } from './components/common';
import Header from './components/header';
import Footer from './components/footer';
import {
  cleanupProps,
  fetchEditableInfo,
  fetchReadOnlyInfo,
} from './SupabaseGrid.utils';

/**
 * Supabase Grid.
 *
 * React component to render database table.
 */
export const SupabaseGrid = React.forwardRef<
  SupabaseGridRef,
  SupabaseGridProps
>((props, ref) => {
  const monaco = useMonaco();
  const _props = cleanupProps(props);
  const { theme } = _props;

  React.useEffect(() => {
    if (monaco) {
      const darkTheme = theme && theme === 'dark' ? true : false;

      monaco.editor.defineTheme('supabase', {
        base: 'vs-dark', // can also be vs-dark or hc-black
        inherit: true, // can also be false to completely replace the builtin rules
        rules: [
          { token: 'string.sql', foreground: '24b47e' },
          { token: 'comment', foreground: '666666' },
          { token: 'predefined.sql', foreground: 'D4D4D4' },
        ],
        colors: {
          'editor.background': darkTheme ? '#1f1f1f' : '#30313f',
        },
      });
    }
  }, [monaco]);

  return (
    <StoreProvider>
      <DndProvider backend={HTML5Backend}>
        <SupabaseGridLayout ref={ref} {..._props} />
      </DndProvider>
    </StoreProvider>
  );
});

const SupabaseGridLayout = React.forwardRef<SupabaseGridRef, SupabaseGridProps>(
  (props, ref) => {
    const { editable, storageRef, gridProps, headerActions } = props;
    const dispatch = useDispatch();
    const state = useTrackedState();
    const gridRef = React.useRef<DataGridHandle>(null);
    const [mounted, setMount] = React.useState(false);

    React.useImperativeHandle(ref, () => ({
      rowAdded(row: Dictionary<any>) {
        dispatch({
          type: 'ADD_NEW_ROW',
          payload: row,
        });
        console.log('rowAdded: ', row);
      },
      rowEdited(row: Dictionary<any>, idx: number) {
        dispatch({
          type: 'EDIT_ROW',
          payload: { row, idx },
        });
        console.log('rowEdited: ', row, 'at index: ', idx);
      },
    }));

    React.useEffect(() => {
      if (!mounted) setMount(true);
    }, []);

    React.useEffect(() => {
      if (state.isInitialComplete && storageRef && state.table) {
        saveStorageDebounced(state, storageRef);
      }
    }, [
      state.table,
      state.isInitialComplete,
      state.gridColumns,
      state.sorts,
      state.filters,
      storageRef,
    ]);

    React.useEffect(() => {
      if (state.refreshPageFlag == REFRESH_PAGE_IMMEDIATELY) {
        fetchPage(state, dispatch);
      } else if (state.refreshPageFlag != 0) {
        refreshPageDebounced(state, dispatch);
      }
    }, [state.refreshPageFlag]);

    React.useEffect(() => {
      if (state.totalRows === TOTAL_ROWS_RESET) {
        fetchCount(state, dispatch);
      }
    }, [state.totalRows]);

    React.useEffect(() => {
      if (!state.metaService) {
        dispatch({
          type: 'INIT_CLIENT',
          payload: { onSqlQuery: props.onSqlQuery },
        });
        dispatch({
          type: 'INIT_CALLBACK',
          payload: { ...props },
        });
      }
    }, [state.metaService]);

    React.useEffect(() => {
      if (!state.metaService) return;

      if (
        !state.table ||
        (typeof props.table == 'string' && state.table!.name != props.table) ||
        (typeof props.table != 'string' &&
          JSON.stringify(props.table) !== JSON.stringify(state.table))
      ) {
        initTable(props, state, dispatch);
      }
    }, [state.metaService, state.table, props.table]);

    return (
      <div className="sb-grid">
        <Header
          onAddRow={editable ? props.onAddRow : undefined}
          onAddColumn={editable ? props.onAddColumn : undefined}
          headerActions={headerActions}
        />
        <Grid ref={gridRef} {...gridProps} />
        <Footer />
        <Shortcuts gridRef={gridRef} />
        {mounted && createPortal(<RowContextMenu />, document.body)}
      </div>
    );
  }
);

function defaultErrorHandler(error: any) {
  console.log('Supabase grid error: ', error);
}

function initTable(
  props: SupabaseGridProps,
  state: InitialStateType,
  dispatch: (value: any) => void
) {
  function onLoadStorage(storageRef: string, tableName: string) {
    const key = getStorageKey(STORAGE_KEY_PREFIX, storageRef);
    const jsonStr = localStorage.getItem(key);
    if (!jsonStr) return;
    const json = JSON.parse(jsonStr);
    return json[tableName];
  }

  function onInitTable(table: SupaTable, props: SupabaseGridProps) {
    const gridColumns = getGridColumns(table, {
      defaultWidth: props.gridProps?.defaultColumnWidth,
      onAddColumn: props.editable ? props.onAddColumn : undefined,
    });

    let savedState;
    if (props.storageRef) {
      savedState = onLoadStorage(props.storageRef, table.name);
      // console.log('savedState', savedState);
    }

    dispatch({
      type: 'INIT_TABLE',
      payload: {
        table,
        gridProps: props.gridProps,
        gridColumns,
        savedState,
        editable: props.editable,
        onSqlQuery: props.onSqlQuery,
        onError: props.onError ?? defaultErrorHandler,
      },
    });
  }

  if (typeof props.table === 'string') {
    const fetchMethod = props.editable
      ? fetchEditableInfo(state.metaService!, props.table, props.schema)
      : fetchReadOnlyInfo(state.metaService!, props.table, props.schema);

    fetchMethod.then((res) => {
      if (res) onInitTable(res, props);
      else {
        if (props.onError) {
          props.onError({ message: 'fetch table info failed' });
        }
      }
    });
  } else {
    onInitTable(props.table, props);
  }
}

function saveStorage(state: InitialStateType, storageRef: string) {
  if (!state.table) return;

  const config = {
    gridColumns: state.gridColumns,
    sorts: state.sorts,
    filters: state.filters,
  };
  const key = getStorageKey(STORAGE_KEY_PREFIX, storageRef);
  const savedStr = localStorage.getItem(key);

  let savedJson;
  if (savedStr) {
    savedJson = JSON.parse(savedStr);
    savedJson = { ...savedJson, [state.table.name]: config };
  } else {
    savedJson = { [state.table.name]: config };
  }
  localStorage.setItem(key, JSON.stringify(savedJson));
}
const saveStorageDebounced = AwesomeDebouncePromise(saveStorage, 500);
