import { SaleDecimal, quarterMoney as roundMoney, calculateSaleLine as calculateLine } from './satis-totals';
import { isEntityFormReady } from 'app/shared/util/entity-form';
import { formatDecimal } from 'app/shared/util/decimal-format';
import './satis-update.scss';

import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import Alert from 'react-bootstrap/Alert';
import Badge from 'react-bootstrap/Badge';
import Button from 'react-bootstrap/Button';
import Col from 'react-bootstrap/Col';
import Form from 'react-bootstrap/Form';
import InputGroup from 'react-bootstrap/InputGroup';
import Row from 'react-bootstrap/Row';
import Spinner from 'react-bootstrap/Spinner';
import { translate } from 'react-jhipster';
import { Link, useNavigate, useParams } from 'app/shared/routing/navigation';
import dayjs from 'dayjs';
import Fuse from 'fuse.js';

import {
  faArrowLeft,
  faCheck,
  faMinus,
  faPlus,
  faSave,
  faSearch,
  faStar,
  faSync,
  faTrash,
  faUndo,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

import { APP_LOCAL_DATETIME_FORMAT } from 'app/config/constants';
import { useAppDispatch, useAppSelector } from 'app/config/store';
import { getSatisUrunleri } from 'app/entities/urun/urun.reducer';
import { Birim } from 'app/shared/model/enumerations/birim.model';
import { ISatis } from 'app/shared/model/satis.model';
import { ISatisStokHareketleri } from 'app/shared/model/satis-stok-hareketleri.model';
import { IUrun } from 'app/shared/model/urun.model';
import { convertDateTimeFromServer, convertDateTimeToServer } from 'app/shared/util/date-utils';

import { CorrectionFields } from 'app/shared/financial/nobet-correction';
import { IDuzeltmeTalebi } from 'app/shared/model/nobet-duzeltme.model';
import { createEntity, createEntityWithNote, getEntity, reset, updateEntity } from './satis.reducer';

const DRAFT_KEY = 'pirot.satis.draft.v1';
const FAVORITES_KEY = 'pirot.satis.favorites.v1';
const RECENTS_KEY = 'pirot.satis.recents.v1';
const GRAM_STEP = 100;

type PaymentType = 'CASH' | 'CARD' | 'DEFERRED';
type Draft = {
  lines: { productId: number; quantity: number }[];
  paymentType: PaymentType;
  memberSale: boolean;
  discount: number | string;
  cashGiven: string;
  note: string;
  date: string;
};

const t = (key: string, data?: Record<string, unknown>) => translate('koopApp.satis.pos.' + key, data);
const money = (value: number | string) => formatDecimal(value);
// Normalize Turkish product names so fuzzy matching treats ş/ç/ğ/ö/ü/ı/İ as their ASCII form.
const normalizeTr = (value: string) =>
  value
    .toLocaleLowerCase('tr')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i');

const storedIds = (key: string) => {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(value) ? (value.filter(id => Number.isInteger(id)).slice(0, 12) as number[]) : [];
  } catch {
    return [];
  }
};

export const SatisUpdate = () => {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { id } = useParams<'id'>();
  const isNew = id === undefined;
  const sale: ISatis = useAppSelector(state => state.satis.entity);
  const formReady = isEntityFormReady(sale, id, isNew);
  const updating = useAppSelector(state => state.satis.updating);
  const updateSuccess = useAppSelector(state => state.satis.updateSuccess);
  const updateError = useAppSelector(state => state.satis.errorMessage);
  const products = useAppSelector(state => state.urun.satisUrunleri);
  const productsLoading = useAppSelector(state => state.urun.loading);
  const productsError = useAppSelector(state => state.urun.errorMessage);
  const tenantId = useAppSelector(state => state.authentication.account?.tenantId);

  const [lines, setLines] = useState<ISatisStokHareketleri[]>([]);
  const [query, setQuery] = useState('');
  const [resultsOpen, setResultsOpen] = useState(false);
  const [activeResult, setActiveResult] = useState(0);
  const [searchError, setSearchError] = useState('');
  const [lineErrors, setLineErrors] = useState<Record<number, string>>({});
  const [removed, setRemoved] = useState<{ line: ISatisStokHareketleri; index: number } | null>(null);
  const [paymentType, setPaymentType] = useState<PaymentType>('CASH');
  const [memberSale, setMemberSale] = useState(false);
  const [discount, setDiscount] = useState('0');
  const [closed, setClosed] = useState(false);
  const [duzeltme, setDuzeltme] = useState<IDuzeltmeTalebi>();
  const [correctionBlocked, setCorrectionBlocked] = useState(true);
  const [cashGiven, setCashGiven] = useState('');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(() => (isNew ? dayjs().format(APP_LOCAL_DATETIME_FORMAT) : ''));
  const [favoriteIds, setFavoriteIds] = useState(() => storedIds(FAVORITES_KEY));
  const [recentIds, setRecentIds] = useState(() => storedIds(RECENTS_KEY));
  const [draftRestored, setDraftRestored] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [completedId, setCompletedId] = useState<number | null>(null);
  const [previousTotal, setPreviousTotal] = useState('0.00');
  const [originalQuantities, setOriginalQuantities] = useState<Record<number, number>>({});
  const searchRef = useRef<HTMLInputElement>(null);
  const draftReadyRef = useRef(!isNew);
  const deferredQuery = useDeferredValue(query);

  const normalizedQuery = useMemo(() => normalizeTr(deferredQuery.trim()), [deferredQuery]);
  const productSearchIndex = useMemo(() => {
    const items = products.map(product => ({ product, searchKey: normalizeTr(product.urunAdi ?? '') }));
    return new Fuse<{ product: IUrun; searchKey: string }>(items, { keys: ['searchKey'], threshold: 0.4, ignoreLocation: true });
  }, [products]);

  const searchResults = useMemo(() => {
    if (normalizedQuery) {
      return productSearchIndex
        .search(normalizedQuery)
        .slice(0, 30)
        .map(result => result.item.product);
    }
    const priority = new Map([...favoriteIds, ...recentIds].map((productId, index) => [productId, index]));
    return products
      .slice()
      .sort((a, b) => (priority.get(a.id ?? -1) ?? 999) - (priority.get(b.id ?? -1) ?? 999))
      .slice(0, 20);
  }, [favoriteIds, normalizedQuery, productSearchIndex, products, recentIds]);

  const subtotal = useMemo(
    () => lines.reduce((sum, line) => new SaleDecimal(sum).plus(calculateLine(line.urun, line.miktar)).toFixed(2), '0.00'),
    [lines],
  );
  const total = roundMoney(new SaleDecimal(subtotal).times(new SaleDecimal(100).minus(discount)).div(100).toDecimalPlaces(6));
  const discountAmount = new SaleDecimal(subtotal).minus(total).toFixed(2);
  const cash = new SaleDecimal(cashGiven || 0);
  const change = roundMoney(SaleDecimal.max(0, cash.minus(total)));
  const cashInsufficient = paymentType === 'CASH' && cashGiven !== '' && cash.lt(total);
  const availableStock = (product?: IUrun) =>
    new SaleDecimal(product?.stok ?? 0).plus(!isNew && product?.id ? (originalQuantities[product.id] ?? 0) : 0).toString();
  const stockLimit = (product?: IUrun) =>
    SaleDecimal.min(new SaleDecimal(availableStock(product)).floor(), Number.MAX_SAFE_INTEGER).toNumber();
  const invalidLines = lines.some(
    line =>
      !Number.isSafeInteger(line.miktar) || !line.miktar || line.miktar <= 0 || new SaleDecimal(line.miktar).gt(availableStock(line.urun)),
  );
  const deferredNoteMissing = isNew && paymentType === 'DEFERRED' && note.trim() === '';
  const canSubmit = !!lines.length && !invalidLines && !deferredNoteMissing && !updating && (isNew || !correctionBlocked);
  const dirty = lines.length > 0 || paymentType !== 'CASH' || memberSale || new SaleDecimal(discount).gt(0) || note.trim() !== '';
  const cashPresets = useMemo(
    () =>
      [...new Set([total, '50.00', '100.00', '200.00', '500.00', new SaleDecimal(total).div(50).ceil().times(50).toFixed(2)])]
        .filter(value => new SaleDecimal(value).gte(total) && new SaleDecimal(value).gt(0))
        .sort((a, b) => new SaleDecimal(a).comparedTo(b))
        .slice(0, 5),
    [total],
  );

  useEffect(() => {
    if (isNew) dispatch(reset());
    else if (id) dispatch(getEntity(id));
    dispatch(getSatisUrunleri());
  }, [dispatch, id, isNew]);

  useEffect(() => {
    if (!isNew && sale?.id && sale.stokHareketleriLists) {
      setLines(sale.stokHareketleriLists.map(line => ({ ...line })));
      setPaymentType(sale.sonraOdeme ? 'DEFERRED' : sale.kartliSatis ? 'CARD' : 'CASH');
      setMemberSale(!!sale.ortagaSatis);
      setDate(convertDateTimeFromServer(sale.tarih) ?? '');
      setPreviousTotal(String(sale.toplamTutar ?? '0.00'));
      setOriginalQuantities(
        sale.stokHareketleriLists.reduce<Record<number, number>>((quantities, line) => {
          if (line.urun?.id) quantities[line.urun.id] = (quantities[line.urun.id] ?? 0) + (line.miktar ?? 0);
          return quantities;
        }, {}),
      );
      const originalSubtotal = sale.stokHareketleriLists.reduce(
        (sum, line) => new SaleDecimal(sum).plus(line.tutar ?? calculateLine(line.urun, line.miktar)).toFixed(2),
        '0.00',
      );
      const inferredDiscount =
        sale.indirim != null
          ? new SaleDecimal(sale.indirim)
          : new SaleDecimal(originalSubtotal).gt(0)
            ? new SaleDecimal(100).minus(
                new SaleDecimal(sale.toplamTutar ?? originalSubtotal).times(100).div(originalSubtotal).toDecimalPlaces(6),
              )
            : new SaleDecimal(0);
      setDiscount(inferredDiscount.clamp(0, 100).toString());
    }
  }, [isNew, sale]);

  useEffect(() => {
    if (isNew || products.length === 0) return;
    setLines(current => current.map(line => ({ ...line, urun: products.find(product => product.id === line.urun?.id) ?? line.urun })));
  }, [isNew, products]);

  useEffect(() => {
    if (!isNew || draftReadyRef.current || products.length === 0) return;
    draftReadyRef.current = true;
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw) as Draft;
      const restored = draft.lines.reduce<ISatisStokHareketleri[]>((result, item) => {
        const product = products.find(candidate => candidate.id === item.productId);
        if (product) result.push({ urun: product, miktar: item.quantity });
        return result;
      }, []);
      if (!restored.length) return;
      setLines(restored);
      setPaymentType(draft.paymentType ?? 'CASH');
      setMemberSale(!!draft.memberSale);
      setDiscount(new SaleDecimal(draft.discount ?? 0).clamp(0, 100).toString());
      setCashGiven(draft.cashGiven ?? '');
      setNote(draft.note ?? '');
      setDate(draft.date || dayjs().format(APP_LOCAL_DATETIME_FORMAT));
      setDraftRestored(true);
    } catch {
      localStorage.removeItem(DRAFT_KEY);
    }
  }, [isNew, products]);

  useEffect(() => {
    if (!isNew || !draftReadyRef.current || completedId) return;
    if (!dirty) {
      localStorage.removeItem(DRAFT_KEY);
      return;
    }
    const draft: Draft = {
      lines: lines.filter(line => line.urun?.id != null).map(line => ({ productId: line.urun!.id!, quantity: line.miktar ?? 0 })),
      paymentType,
      memberSale,
      discount,
      cashGiven,
      note,
      date,
    };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  }, [cashGiven, completedId, date, dirty, discount, isNew, lines, memberSale, note, paymentType]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty || updating || completedId) return;
      event.preventDefault();
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [completedId, dirty, updating]);

  useEffect(() => {
    if (!updateSuccess || !submitted || !sale?.id) return;
    setSubmitted(false);
    localStorage.removeItem(DRAFT_KEY);
    if (isNew) setCompletedId(sale.id);
    else navigate('/satis');
  }, [isNew, navigate, sale?.id, submitted, updateSuccess]);

  const remember = (productId: number) => {
    const next = [productId, ...recentIds.filter(value => value !== productId)].slice(0, 12);
    setRecentIds(next);
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  };

  const toggleFavorite = (productId: number) => {
    const next = favoriteIds.includes(productId)
      ? favoriteIds.filter(value => value !== productId)
      : [productId, ...favoriteIds].slice(0, 12);
    setFavoriteIds(next);
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
  };

  const addProduct = (product: IUrun) => {
    const stock = stockLimit(product);
    if (stock <= 0) {
      setSearchError(t('outOfStockMessage', { product: product.urunAdi }));
      return;
    }
    const quantity = Math.min(product.birim === Birim.GRAM ? GRAM_STEP : 1, stock);
    const index = lines.findIndex(line => line.urun?.id === product.id);
    if (index < 0) setLines([...lines, { urun: product, miktar: quantity }]);
    else {
      const next = [...lines];
      const requested = (next[index].miktar ?? 0) + quantity;
      next[index] = { ...next[index], miktar: Math.min(requested, stock) };
      setLines(next);
      if (requested > stock) setLineErrors(errors => ({ ...errors, [product.id!]: t('stockLimit', { stock }) }));
    }
    remember(product.id!);
    setQuery('');
    setResultsOpen(false);
    setSearchError('');
    setActiveResult(0);
    requestAnimationFrame(() => searchRef.current?.focus());
  };

  const changeQuantity = (index: number, quantity: number) => {
    const line = lines[index];
    const normalized = Number.isFinite(quantity) ? Math.max(0, quantity) : 0;
    const next = [...lines];
    next[index] = { ...line, miktar: normalized };
    setLines(next);
    if (!line.urun?.id) return;
    setLineErrors(errors => {
      const updated = { ...errors };
      if (!Number.isSafeInteger(normalized) || normalized <= 0) updated[line.urun!.id!] = t('positiveQuantity');
      else if (new SaleDecimal(normalized).gt(availableStock(line.urun)))
        updated[line.urun!.id!] = t('stockLimit', { stock: availableStock(line.urun) });
      else delete updated[line.urun!.id!];
      return updated;
    });
  };

  const removeLine = (index: number) => {
    setRemoved({ line: lines[index], index });
    setLines(lines.filter((_, current) => current !== index));
  };

  const undoRemove = () => {
    if (!removed) return;
    const next = [...lines];
    next.splice(removed.index, 0, removed.line);
    setLines(next);
    setRemoved(null);
  };

  const searchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!resultsOpen || searchResults.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveResult(value => Math.min(value + 1, searchResults.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveResult(value => Math.max(value - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      addProduct(searchResults[activeResult]);
    } else if (event.key === 'Escape') setResultsOpen(false);
  };

  const selectPayment = (next: PaymentType) => {
    if (!isNew && sale.sonraOdeme) return;
    setPaymentType(next);
    setCashGiven('');
    if (next !== 'DEFERRED') setNote('');
  };

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    const payload = {
      duzeltme,
      id: isNew ? undefined : sale.id,
      tarih: convertDateTimeToServer(date) ?? dayjs().toISOString(),
      ortagaSatis: memberSale,
      kartliSatis: paymentType === 'CARD',
      sonraOdeme: paymentType === 'DEFERRED',
      indirim: discount,
      stokHareketleriLists: lines.map(line => ({ urunId: line.urun?.id, miktar: line.miktar })),
    };
    setSubmitted(true);
    if (isNew && paymentType === 'DEFERRED' && note.trim()) dispatch(createEntityWithNote({ entity: payload, note: note.trim() }));
    else if (isNew) dispatch(createEntity(payload));
    else dispatch(updateEntity({ ...payload, odendi: sale.odendi }));
  };

  const startNew = () => {
    setLines([]);
    setQuery('');
    setSearchError('');
    setLineErrors({});
    setRemoved(null);
    setPaymentType('CASH');
    setMemberSale(false);
    setDiscount('0');
    setCashGiven('');
    setNote('');
    setOriginalQuantities({});
    setDate(dayjs().format(APP_LOCAL_DATETIME_FORMAT));
    setCompletedId(null);
    setDraftRestored(false);
    dispatch(reset());
    dispatch(getSatisUrunleri());
    requestAnimationFrame(() => searchRef.current?.focus());
  };

  const cancel = () => {
    if (!dirty || window.confirm(t('unsavedConfirm'))) navigate('/satis');
  };

  if (completedId)
    return (
      <div className="satis-update satis-complete-wrap">
        <section className="satis-complete-card text-center">
          <div className="satis-complete-icon">
            <FontAwesomeIcon icon={faCheck} />
          </div>
          <h2>{t('completed')}</h2>
          <p className="text-muted">{t('completedDetail', { id: completedId })}</p>
          <div className="d-flex flex-wrap justify-content-center gap-2">
            <Button onClick={startNew} autoFocus>
              <FontAwesomeIcon icon={faPlus} /> {t('newSale')}
            </Button>
            <Button as={Link as any} to={'/satis/' + completedId} variant="outline-secondary">
              {t('viewSale')}
            </Button>
            <Button as={Link as any} to="/satis" variant="outline-secondary">
              {t('saleList')}
            </Button>
          </div>
        </section>
      </div>
    );

  return (
    <div className="satis-update">
      <div className="satis-page-heading">
        <div>
          <span className="satis-eyebrow">{t('checkout')}</span>
          <h2 id="koopApp.satis.home.createOrEditLabel">{t(isNew ? 'createTitle' : 'editTitle')}</h2>
        </div>
        <Button type="button" variant="outline-secondary" size="sm" onClick={() => dispatch(getSatisUrunleri())} disabled={productsLoading}>
          <FontAwesomeIcon icon={faSync} spin={productsLoading} /> {t('refreshStock')}
        </Button>
      </div>
      {!isNew && <Alert variant="warning">{t('editWarning')}</Alert>}
      {draftRestored && (
        <Alert variant="info" dismissible onClose={() => setDraftRestored(false)}>
          {t('draftRestored')}
        </Alert>
      )}
      {(updateError || productsError) && (
        <Alert variant="danger" aria-live="assertive">
          {t('saveFailed')}{' '}
          <Button type="button" size="sm" variant="outline-danger" onClick={() => dispatch(getSatisUrunleri())}>
            <FontAwesomeIcon icon={faSync} /> {t('refreshStock')}
          </Button>
        </Alert>
      )}

      {formReady ? (
        <Form onSubmit={save}>
          <CorrectionFields type="satis" id={id} onChange={setDuzeltme} onBlocked={setCorrectionBlocked} onClosed={setClosed} />
          <Row className="g-4 align-items-start">
            <Col lg={7} xl={8}>
              <section className="satis-section-card product-picker-card">
                <div className="section-heading-row">
                  <div>
                    <h3 className="satis-section-title">{t('addProduct')}</h3>
                    <p>{t('searchHint')}</p>
                  </div>
                </div>
                <div className="urun-arama">
                  <InputGroup size="lg">
                    <InputGroup.Text>
                      <FontAwesomeIcon icon={faSearch} />
                    </InputGroup.Text>
                    <Form.Control
                      ref={searchRef}
                      autoFocus
                      autoComplete="off"
                      role="combobox"
                      aria-expanded={resultsOpen}
                      aria-controls="satis-urun-sonuclari"
                      aria-activedescendant={searchResults[activeResult]?.id ? 'satis-urun-' + searchResults[activeResult].id : undefined}
                      placeholder={t('searchPlaceholder')}
                      value={query}
                      onFocus={() => setResultsOpen(true)}
                      onChange={event => {
                        setQuery(event.target.value);
                        setResultsOpen(true);
                        setActiveResult(0);
                        setSearchError('');
                      }}
                      onKeyDown={searchKeyDown}
                    />
                  </InputGroup>
                  {searchError && (
                    <div className="inline-error mt-2" role="alert">
                      {searchError}
                    </div>
                  )}
                  {resultsOpen && (
                    <div id="satis-urun-sonuclari" className="urun-sonuclar" role="listbox">
                      {!deferredQuery.trim() && <div className="urun-sonuc-baslik">{t('quickProducts')}</div>}
                      {productsLoading && products.length === 0 ? (
                        <div className="urun-sonuc-durum">
                          <Spinner animation="border" size="sm" /> {t('loadingProducts')}
                        </div>
                      ) : searchResults.length > 0 ? (
                        searchResults.map((product, index) => {
                          const productStock = availableStock(product);
                          const outOfStock = new SaleDecimal(productStock).lt(1);
                          const favorite = favoriteIds.includes(product.id!);
                          return (
                            <div
                              id={'satis-urun-' + product.id}
                              key={product.id}
                              role="option"
                              aria-selected={index === activeResult}
                              className={'urun-sonuc ' + (index === activeResult ? 'active ' : '') + (outOfStock ? 'stok-yok' : '')}
                              onMouseDown={event => {
                                event.preventDefault();
                                addProduct(product);
                              }}
                              onMouseEnter={() => setActiveResult(index)}
                            >
                              <div className="urun-sonuc-main">
                                <strong>{product.urunAdi}</strong>
                                <span>
                                  {money(product.musteriFiyati ?? 0)} TL / {product.birim}
                                </span>
                              </div>
                              <div className="urun-sonuc-actions">
                                <Badge bg={outOfStock ? 'danger' : 'light'} text={outOfStock ? undefined : 'dark'}>
                                  {outOfStock ? t('outOfStock') : productStock + ' ' + product.birim}
                                </Badge>
                                <Button
                                  type="button"
                                  variant="link"
                                  className={'favorite-button ' + (favorite ? 'active' : '')}
                                  aria-label={t(favorite ? 'removeFavorite' : 'addFavorite')}
                                  onMouseDown={event => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    toggleFavorite(product.id!);
                                  }}
                                >
                                  <FontAwesomeIcon icon={faStar} />
                                </Button>
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <div className="urun-sonuc-durum">
                          <strong>{t('noProduct')}</strong>
                          <span>{t('tryAnotherSearch')}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </section>

              <section className="satis-section-card sepet-card mt-4">
                <div className="section-heading-row">
                  <div>
                    <h3 className="satis-section-title">{t('cart')}</h3>
                    <p>{t('cartCount', { count: lines.length })}</p>
                  </div>
                </div>
                {removed && (
                  <div className="undo-row" role="status">
                    <span>{t('productRemoved', { product: removed.line.urun?.urunAdi })}</span>
                    <Button type="button" variant="link" size="sm" onClick={undoRemove}>
                      <FontAwesomeIcon icon={faUndo} /> {t('undo')}
                    </Button>
                  </div>
                )}
                {lines.length === 0 ? (
                  <div className="empty-cart">
                    <FontAwesomeIcon icon={faSearch} />
                    <strong>{t('emptyCart')}</strong>
                    <span>{t('emptyCartHint')}</span>
                  </div>
                ) : (
                  <div className="sepet-listesi">
                    {lines.map((line, index) => {
                      const productId = line.urun?.id ?? index;
                      const gram = line.urun?.birim === Birim.GRAM;
                      return (
                        <article className="sepet-satiri" key={productId}>
                          <div className="sepet-urun">
                            <strong>{line.urun?.urunAdi}</strong>
                            <span>
                              {money(line.urun?.musteriFiyati ?? 0)} TL / {line.urun?.birim} · {t('stock')}: {availableStock(line.urun)}
                            </span>
                          </div>
                          <div className="miktar-kontrol">
                            <Button
                              type="button"
                              variant="outline-secondary"
                              aria-label={t('decrease')}
                              onClick={() => changeQuantity(index, (line.miktar ?? 0) - (gram ? 50 : 1))}
                            >
                              <FontAwesomeIcon icon={faMinus} />
                            </Button>
                            <Form.Control
                              type="number"
                              min={1}
                              step={gram ? 50 : 1}
                              value={line.miktar ?? 0}
                              aria-label={t('quantityFor', { product: line.urun?.urunAdi })}
                              isInvalid={!!lineErrors[productId]}
                              onChange={event => changeQuantity(index, Number(event.target.value))}
                            />
                            <Button
                              type="button"
                              variant="outline-secondary"
                              aria-label={t('increase')}
                              onClick={() => changeQuantity(index, (line.miktar ?? 0) + (gram ? 50 : 1))}
                            >
                              <FontAwesomeIcon icon={faPlus} />
                            </Button>
                          </div>
                          {gram && (
                            <div className="gram-presets">
                              {[100, 250, 500, 1000].map(preset => (
                                <Button
                                  key={preset}
                                  type="button"
                                  size="sm"
                                  variant="light"
                                  disabled={new SaleDecimal(preset).gt(availableStock(line.urun))}
                                  onClick={() => changeQuantity(index, preset)}
                                >
                                  {preset === 1000 ? '1 kg' : preset + ' g'}
                                </Button>
                              ))}
                            </div>
                          )}
                          <strong className="satir-tutari">{money(calculateLine(line.urun, line.miktar))} TL</strong>
                          <Button
                            type="button"
                            variant="outline-danger"
                            className="satir-sil"
                            aria-label={t('removeProduct', { product: line.urun?.urunAdi })}
                            onClick={() => removeLine(index)}
                          >
                            <FontAwesomeIcon icon={faTrash} />
                          </Button>
                          {lineErrors[productId] && (
                            <div className="satir-error" role="alert">
                              {lineErrors[productId]}
                            </div>
                          )}
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>
            </Col>

            <CheckoutSummary
              isNew={isNew}
              dateDisabled={closed}
              deferredOnly={!isNew && !!sale.sonraOdeme}
              paymentType={paymentType}
              onPaymentSelect={selectPayment}
              memberSale={memberSale}
              onMemberSaleChange={setMemberSale}
              cashGiven={cashGiven}
              onCashGivenChange={setCashGiven}
              cashInsufficient={cashInsufficient}
              cashPresets={cashPresets}
              total={total}
              change={change}
              note={note}
              onNoteChange={setNote}
              deferredNoteMissing={deferredNoteMissing}
              discount={discount}
              onDiscountChange={setDiscount}
              date={date}
              onDateChange={setDate}
              tenantId={tenantId}
              subtotal={subtotal}
              discountAmount={discountAmount}
              previousTotal={previousTotal}
            />
          </Row>

          <div className="mobile-checkout-bar">
            <Button type="button" variant="outline-secondary" onClick={cancel} aria-label={t('back')}>
              <FontAwesomeIcon icon={faArrowLeft} />
            </Button>
            <div>
              <span>{t('total')}</span>
              <strong>{money(total)} TL</strong>
            </div>
            <Button id="save-entity" type="submit" disabled={!canSubmit}>
              {updating ? <Spinner animation="border" size="sm" /> : <FontAwesomeIcon icon={faSave} />}{' '}
              {t(isNew ? 'completeSale' : 'updateSale')}
            </Button>
          </div>
          <div className="desktop-actions">
            <Button type="button" variant="outline-secondary" onClick={cancel}>
              <FontAwesomeIcon icon={faArrowLeft} /> {t('back')}
            </Button>
            <Button id="save-entity-desktop" type="submit" size="lg" disabled={!canSubmit}>
              {updating ? <Spinner animation="border" size="sm" /> : <FontAwesomeIcon icon={faSave} />}{' '}
              {t(isNew ? 'completeSale' : 'updateSale')} · {money(total)} TL
            </Button>
          </div>
        </Form>
      ) : (
        <div className="satis-loading">
          <Spinner animation="border" />
        </div>
      )}
    </div>
  );
};

const CheckoutSummary = (props: {
  isNew: boolean;
  dateDisabled: boolean;
  deferredOnly: boolean;
  paymentType: PaymentType;
  onPaymentSelect: (next: PaymentType) => void;
  memberSale: boolean;
  onMemberSaleChange: (checked: boolean) => void;
  cashGiven: string;
  onCashGivenChange: (value: string) => void;
  cashInsufficient: boolean;
  cashPresets: string[];
  total: string;
  change: string;
  note: string;
  onNoteChange: (value: string) => void;
  deferredNoteMissing: boolean;
  discount: string;
  onDiscountChange: (value: string) => void;
  date: string;
  onDateChange: (value: string) => void;
  tenantId?: number | null;
  subtotal: string;
  discountAmount: string;
  previousTotal: string;
}) => {
  const {
    isNew,
    dateDisabled,
    deferredOnly,
    paymentType,
    onPaymentSelect,
    memberSale,
    onMemberSaleChange,
    cashGiven,
    onCashGivenChange,
    cashInsufficient,
    cashPresets,
    total,
    change,
    note,
    onNoteChange,
    deferredNoteMissing,
    discount,
    onDiscountChange,
    date,
    onDateChange,
    tenantId,
    subtotal,
    discountAmount,
    previousTotal,
  } = props;
  return (
    <>
      <Col lg={5} xl={4}>
        <div className="checkout-sticky">
          <section className="satis-section-card summary-card">
            <h3 className="satis-section-title">{t('payment')}</h3>
            <div className="odeme-segment" role="radiogroup" aria-label={t('paymentType')}>
              {(['CASH', 'CARD', 'DEFERRED'] as PaymentType[]).map(type => (
                <Button
                  key={type}
                  type="button"
                  variant={paymentType === type ? 'primary' : 'outline-secondary'}
                  role="radio"
                  aria-checked={paymentType === type}
                  disabled={deferredOnly && type !== 'DEFERRED'}
                  onClick={() => onPaymentSelect(type)}
                >
                  {t('payment' + type)}
                </Button>
              ))}
            </div>
            <Form.Check
              className="buyer-type"
              id="satis-ortagaSatis"
              type="switch"
              checked={memberSale}
              onChange={event => onMemberSaleChange(event.target.checked)}
              label={t('memberSale')}
            />

            {paymentType === 'CASH' && (
              <div className="nakit-panel">
                <Form.Label htmlFor="satis-nakit">{t('cashGiven')}</Form.Label>
                <InputGroup>
                  <Form.Control
                    id="satis-nakit"
                    type="number"
                    min={0}
                    step="any"
                    value={cashGiven}
                    isInvalid={cashInsufficient}
                    onChange={event => onCashGivenChange(event.target.value)}
                    placeholder="0"
                  />
                  <InputGroup.Text>TL</InputGroup.Text>
                </InputGroup>
                {cashInsufficient && <div className="inline-error">{t('insufficientCash')}</div>}
                <div className="cash-presets">
                  {cashPresets.map(value => (
                    <Button key={value} type="button" variant="light" size="sm" onClick={() => onCashGivenChange(String(value))}>
                      {value === total ? t('exactCash') : money(value) + ' TL'}
                    </Button>
                  ))}
                </div>
                <div className="change-row">
                  <span>{t('change')}</span>
                  <strong>{money(change)} TL</strong>
                </div>
              </div>
            )}

            {paymentType === 'DEFERRED' && (
              <Form.Group className="deferred-note" controlId="satis-sonraOdemeNotu">
                <Form.Label>{t('paymentNote')}</Form.Label>
                <Form.Control
                  as="textarea"
                  rows={3}
                  maxLength={500}
                  value={note}
                  isInvalid={deferredNoteMissing}
                  disabled={!isNew}
                  onChange={event => onNoteChange(event.target.value)}
                  placeholder={t('paymentNotePlaceholder')}
                />
                {deferredNoteMissing && <Form.Control.Feedback type="invalid">{t('paymentNoteRequired')}</Form.Control.Feedback>}
                <Form.Text>{t('paymentNoteHint')}</Form.Text>
              </Form.Group>
            )}

            <details className="advanced-options">
              <summary>{t('advancedOptions')}</summary>
              <div className="advanced-content">
                <Form.Group controlId="satis-tarih">
                  <Form.Label>{t('saleDate')}</Form.Label>
                  <Form.Control
                    type="datetime-local"
                    disabled={dateDisabled}
                    value={date}
                    onChange={event => onDateChange(event.target.value)}
                  />
                </Form.Group>
                {tenantId === 2 && (
                  <Form.Group controlId="satis-indirim">
                    <Form.Label>{t('discount')}</Form.Label>
                    <InputGroup>
                      <Form.Control
                        type="number"
                        min={0}
                        max={100}
                        value={discount}
                        onChange={event => onDiscountChange(new SaleDecimal(event.target.value || 0).clamp(0, 100).toString())}
                      />
                      <InputGroup.Text>%</InputGroup.Text>
                    </InputGroup>
                  </Form.Group>
                )}
              </div>
            </details>

            <div className="total-breakdown">
              <div>
                <span>{t('subtotal')}</span>
                <span>{money(subtotal)} TL</span>
              </div>
              {new SaleDecimal(discount).gt(0) && (
                <div className="discount-line">
                  <span>
                    {t('discountAmount')} (%{discount})
                  </span>
                  <span>−{money(discountAmount)} TL</span>
                </div>
              )}
              <div className="grand-total">
                <span>{t('total')}</span>
                <strong>{money(total)} TL</strong>
              </div>
              {!isNew && (
                <div className="edit-difference">
                  <span>
                    {t('previousTotal')}: {money(previousTotal)} TL
                  </span>
                  <span>
                    {t('difference')}: {money(new SaleDecimal(total).minus(previousTotal).toFixed(2))} TL
                  </span>
                </div>
              )}
            </div>
          </section>
        </div>
      </Col>
    </>
  );
};

export default SatisUpdate;
