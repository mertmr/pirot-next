import React, { useEffect, useState } from 'react';
import Button from 'react-bootstrap/Button';
import Table from 'react-bootstrap/Table';
import { JhiItemCount, JhiPagination, Translate, getPaginationState } from 'react-jhipster';
import { Link, useLocation, useNavigate } from 'app/shared/routing/navigation';

import { faSort, faSortDown, faSortUp } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

import { useAppDispatch, useAppSelector } from 'app/config/store';
import { overridePaginationStateWithQueryParams } from 'app/shared/util/entity-utils';
import { ASC, DESC, ITEMS_PER_PAGE, SORT } from 'app/shared/util/pagination.constants';

import { getEntities } from './urun.reducer';

export const Urun = () => {
  const dispatch = useAppDispatch();

  const pageLocation = useLocation();
  const navigate = useNavigate();

  const [paginationState, setPaginationState] = useState(
    overridePaginationStateWithQueryParams(getPaginationState(pageLocation, ITEMS_PER_PAGE, 'id'), pageLocation.search),
  );

  const urunList = useAppSelector(state => state.urun.entities);
  const loading = useAppSelector(state => state.urun.loading);
  const totalItems = useAppSelector(state => state.urun.totalItems);

  const getAllEntities = () => {
    dispatch(
      getEntities({
        page: paginationState.activePage - 1,
        size: paginationState.itemsPerPage,
        sort: `${paginationState.sort},${paginationState.order}`,
      }),
    );
  };

  const sortEntities = () => {
    getAllEntities();
    const endURL = `?page=${paginationState.activePage}&sort=${paginationState.sort},${paginationState.order}`;
    if (pageLocation.search !== endURL) {
      navigate(`${pageLocation.pathname}${endURL}`);
    }
  };

  useEffect(() => {
    sortEntities();
  }, [paginationState.activePage, paginationState.order, paginationState.sort]);

  useEffect(() => {
    const params = new URLSearchParams(pageLocation.search);
    const page = params.get('page');
    const sort = params.get(SORT);
    if (page && sort) {
      const sortSplit = sort.split(',');
      setPaginationState({
        ...paginationState,
        activePage: +page,
        sort: sortSplit[0],
        order: sortSplit[1],
      });
    }
  }, [pageLocation.search]);

  const sort = p => () => {
    setPaginationState({
      ...paginationState,
      order: paginationState.order === ASC ? DESC : ASC,
      sort: p,
    });
  };

  const handlePagination = currentPage =>
    setPaginationState({
      ...paginationState,
      activePage: currentPage,
    });

  const handleSyncList = () => {
    sortEntities();
  };

  const getSortIconByFieldName = (fieldName: string) => {
    const sortFieldName = paginationState.sort;
    const { order } = paginationState;
    if (sortFieldName !== fieldName) {
      return faSort;
    }
    return order === ASC ? faSortUp : faSortDown;
  };

  return (
    <div>
      <h2 id="urun-heading" data-cy="UrunHeading">
        <Translate contentKey="koopApp.urun.home.title">Uruns</Translate>
        <div className="d-flex justify-content-end">
          <Button className="me-2" variant="info" onClick={handleSyncList} disabled={loading}>
            <FontAwesomeIcon icon="sync" spin={loading} />{' '}
            <Translate contentKey="koopApp.urun.home.refreshListLabel">Refresh List</Translate>
          </Button>
          <Link to="/urun/new" className="btn btn-primary jh-create-entity" id="jh-create-entity" data-cy="entityCreateButton">
            <FontAwesomeIcon icon="plus" />
            &nbsp;
            <Translate contentKey="koopApp.urun.home.createLabel">Create new Urun</Translate>
          </Link>
        </div>
      </h2>
      <div className="table-responsive">
        {urunList?.length > 0 ? (
          <Table responsive>
            <thead>
              <tr>
                <th className="hand" onClick={sort('id')}>
                  <Translate contentKey="koopApp.urun.id">ID</Translate> <FontAwesomeIcon icon={getSortIconByFieldName('id')} />
                </th>
                <th className="hand" onClick={sort('urunAdi')}>
                  <Translate contentKey="koopApp.urun.urunAdi">Urun Adi</Translate>{' '}
                  <FontAwesomeIcon icon={getSortIconByFieldName('urunAdi')} />
                </th>
                <th className="hand" onClick={sort('stok')}>
                  <Translate contentKey="koopApp.urun.stok">Stok</Translate> <FontAwesomeIcon icon={getSortIconByFieldName('stok')} />
                </th>
                <th className="hand" onClick={sort('stokSiniri')}>
                  <Translate contentKey="koopApp.urun.stokSiniri">Stok Siniri</Translate>{' '}
                  <FontAwesomeIcon icon={getSortIconByFieldName('stokSiniri')} />
                </th>
                <th className="hand" onClick={sort('musteriFiyati')}>
                  <Translate contentKey="koopApp.urun.musteriFiyati">Musteri Fiyati</Translate>{' '}
                  <FontAwesomeIcon icon={getSortIconByFieldName('musteriFiyati')} />
                </th>
                <th className="hand" onClick={sort('birim')}>
                  <Translate contentKey="koopApp.urun.birim">Birim</Translate> <FontAwesomeIcon icon={getSortIconByFieldName('birim')} />
                </th>
                <th className="hand" onClick={sort('dayanismaUrunu')}>
                  <Translate contentKey="koopApp.urun.dayanismaUrunu">Dayanisma Urunu</Translate>{' '}
                  <FontAwesomeIcon icon={getSortIconByFieldName('dayanismaUrunu')} />
                </th>
                <th className="hand" onClick={sort('satista')}>
                  <Translate contentKey="koopApp.urun.satista">Satista</Translate>{' '}
                  <FontAwesomeIcon icon={getSortIconByFieldName('satista')} />
                </th>
                <th className="hand" onClick={sort('urunKategorisi')}>
                  <Translate contentKey="koopApp.urun.urunKategorisi">Urun Kategorisi</Translate>{' '}
                  <FontAwesomeIcon icon={getSortIconByFieldName('urunKategorisi')} />
                </th>
                <th className="hand" onClick={sort('active')}>
                  <Translate contentKey="koopApp.urun.active">Active</Translate> <FontAwesomeIcon icon={getSortIconByFieldName('active')} />
                </th>
                <th>
                  <Translate contentKey="koopApp.urun.urunSorumlusu">Urun Sorumlusu</Translate> <FontAwesomeIcon icon="sort" />
                </th>
                <th>
                  <Translate contentKey="koopApp.urun.kdvKategorisi">Kdv Kategorisi</Translate> <FontAwesomeIcon icon="sort" />
                </th>
                <th />
              </tr>
            </thead>
            <tbody>
              {urunList.map(urun => (
                <tr key={`entity-${urun.id}`} data-cy="entityTable">
                  <td>
                    <Button as={Link as any} to={`/urun/${urun.id}`} variant="link" size="sm">
                      {urun.id}
                    </Button>
                  </td>
                  <td>{urun.urunAdi}</td>
                  <td>{urun.stok}</td>
                  <td>{urun.stokSiniri}</td>
                  <td>{urun.musteriFiyati}</td>
                  <td>
                    <Translate contentKey={`koopApp.Birim.${urun.birim ?? 'null'}`} />
                  </td>
                  <td>{urun.dayanismaUrunu ? 'true' : 'false'}</td>
                  <td>{urun.satista ? 'true' : 'false'}</td>
                  <td>
                    <Translate contentKey={`koopApp.UrunKategorisi.${urun.urunKategorisi ?? 'null'}`} />
                  </td>
                  <td>{urun.active ? 'true' : 'false'}</td>
                  <td>{urun.urunSorumlusu ? urun.urunSorumlusu.login : ''}</td>
                  <td>{urun.kdvKategorisi ? <Link to={`/kdv-kategorisi/${urun.kdvKategorisi.id}`}>{urun.kdvKategorisi.id}</Link> : ''}</td>
                  <td className="text-end">
                    <div className="btn-group flex-btn-group-container">
                      <Button as={Link as any} to={`/urun/${urun.id}`} variant="info" size="sm" data-cy="entityDetailsButton">
                        <FontAwesomeIcon icon="eye" />{' '}
                        <span className="d-none d-md-inline">
                          <Translate contentKey="entity.action.view">View</Translate>
                        </span>
                      </Button>
                      <Button
                        as={Link as any}
                        to={`/urun/${urun.id}/edit?page=${paginationState.activePage}&sort=${paginationState.sort},${paginationState.order}`}
                        variant="primary"
                        size="sm"
                        data-cy="entityEditButton"
                      >
                        <FontAwesomeIcon icon="pencil-alt" />{' '}
                        <span className="d-none d-md-inline">
                          <Translate contentKey="entity.action.edit">Edit</Translate>
                        </span>
                      </Button>
                      <Button
                        onClick={() =>
                          (globalThis.location.href = `/urun/${urun.id}/delete?page=${paginationState.activePage}&sort=${paginationState.sort},${paginationState.order}`)
                        }
                        variant="danger"
                        size="sm"
                        data-cy="entityDeleteButton"
                      >
                        <FontAwesomeIcon icon="trash" />{' '}
                        <span className="d-none d-md-inline">
                          <Translate contentKey="entity.action.delete">Delete</Translate>
                        </span>
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          !loading && (
            <div className="alert alert-warning">
              <Translate contentKey="koopApp.urun.home.notFound">No Uruns found</Translate>
            </div>
          )
        )}
      </div>
      {totalItems ? (
        <div className={urunList && urunList.length > 0 ? '' : 'd-none'}>
          <div className="justify-content-center d-flex">
            <JhiItemCount page={paginationState.activePage} total={totalItems} itemsPerPage={paginationState.itemsPerPage} i18nEnabled />
          </div>
          <div className="justify-content-center d-flex">
            <JhiPagination
              activePage={paginationState.activePage}
              onSelect={handlePagination}
              maxButtons={5}
              itemsPerPage={paginationState.itemsPerPage}
              totalItems={totalItems}
            />
          </div>
        </div>
      ) : (
        ''
      )}
    </div>
  );
};

export default Urun;
