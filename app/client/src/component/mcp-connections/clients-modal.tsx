import { useCallback } from 'react';

import { Tag } from '~/component';
import { Button } from '~/control';
import { useModalDialog } from '~/control/use-modal-dialog';

import { useStyle } from './style';

export type McpClientRow = {
  id: string;
  clientName: string;
  clientUri: string | null;
  scopes: readonly string[];
  createdAt: string;
  lastUsedAt: string | null;
};

type McpClientsModalProps = {
  isOpen: boolean;
  clients: readonly McpClientRow[];
  onClose: () => void;
  /** Asks the parent to confirm and revoke; the row stays until that succeeds. */
  onDisconnect: (client: { id: string; name: string }) => void;
};

const formatDate = (iso: string): string => new Date(iso).toLocaleDateString();

/**
 * Every assistant this account has approved, each with a Disconnect. Opened
 * from the "clients" link on the "AI assistants" settings card so the card
 * itself stays a single line: the URL to paste into an assistant.
 */
export const McpClientsModal = ({
  isOpen,
  clients,
  onClose,
  onDisconnect,
}: McpClientsModalProps) => {
  const style = useStyle();
  const modalRef = useModalDialog(isOpen, onClose);
  const handleClickDialog = useCallback((event: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
    event.stopPropagation();
  }, []);

  return (
    <dialog ref={modalRef} className={style.modal} onClick={onClose}>
      <div className={style.dialog} onClick={handleClickDialog}>
        <div className={style.header}>Connected clients</div>
        <div className={style.body}>
          {clients.length === 0 ? (
            <p className={style.hint}>No assistants connected yet.</p>
          ) : (
            <ul className={style.list}>
              {clients.map((client) => {
                const write = client.scopes.includes('library:write');
                return (
                  <li key={client.id} className={style.row}>
                    <div className={style.identity}>
                      <span className={style.nameLine}>
                        {client.clientUri !== null ? (
                          <a
                            className={style.name}
                            href={client.clientUri}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {client.clientName}
                          </a>
                        ) : (
                          <span className={style.name}>{client.clientName}</span>
                        )}
                        <Tag size="sm">{write ? 'Read & write' : 'Read only'}</Tag>
                      </span>
                      <span className={style.meta}>
                        {`Connected ${formatDate(client.createdAt)} · ${
                          client.lastUsedAt === null
                            ? 'Never used'
                            : `Last used ${formatDate(client.lastUsedAt)}`
                        }`}
                      </span>
                    </div>
                    <Button
                      type="link"
                      danger
                      ariaLabel={`Disconnect ${client.clientName}`}
                      onClick={() => onDisconnect({ id: client.id, name: client.clientName })}
                    >
                      Disconnect
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className={style.footer}>
          <Button onClick={onClose} type="primary" radius="modal">
            Close
          </Button>
        </div>
      </div>
    </dialog>
  );
};
