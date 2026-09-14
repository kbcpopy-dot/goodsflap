# 아트텔링 굿즈 스튜디오 MVP

대표 도메인: artell.co.kr. 슬로건: 작품을 일상으로. 5종 상품의 단면 이미지 제작에 집중한다. 마플의 상품→커스텀→주문 흐름만 참고하며 자체 레이아웃과 시각 언어를 사용한다.

## 정보구조와 화면
홈: 브랜드 소개, 5개 상품 카드, 제작 과정. 스튜디오: 옵션, 이미지 업로드, 목업, 위치·크기·회전, 출력 영역 및 해상도 안내, 미리보기, 수량. 장바구니: 디자인별 항목, 삭제, 합계. 주문서: 수령인·연락처·주소, 배송비, 결제. 주문 조회: 현재 브라우저의 주문 목록과 상태. 관리: 관리자 키 인증, 주문 상태, 원본과 출력 PNG 다운로드.

## 기술과 데이터
초기 구현은 Node.js 24 / Express, 브라우저 JavaScript / Canvas, SQLite, Sharp 서버 출력 생성이다. 별도 빌드 없이 실행하고 서버가 가격·옵션·파일·변환 값을 검증한다. SQLite와 로컬 비공개 파일 저장은 단일 서버 MVP용이다. 운영 확대 시 PostgreSQL, 비공개 객체 저장소, 인증 서비스, 작업 큐로 교체한다.

Product: id, name, price, options, printMm. Asset: id, sessionId, format, width, height, path. Design: assetId, productId, option, transform(x,y,scale,rotation), schemaVersion. Order: id, sessionId, recipient, items 스냅샷, amount, status, paymentKey, createdAt. 각 item에 원본·디자인·규격·가격을 동결한다. 주문 상태: pending→paid→production→shipped. 시연 주문은 demo→production→shipped로 구분한다. 원본 접근은 소유 세션 또는 관리자만 가능하다.

## 우선순위
P0: 카탈로그, 단면 편집, 원본 업로드, 가격 검증, 장바구니, 영속 주문 저장, 서버 출력, 시연 주문, 관리. P1: 토스 결제 요청·서버 승인, 운영 인쇄 규격 확정, 인증·결제 재조정·백업·배송 연동. P2: 다면 편집, 상품 관리 UI, AI 변환 작업, 작가/IP 라이선스.

## 구현 범위와 운영 조건
상품과 가격은 가설이며 판매 확정 값이 아니다. 라운드 티셔츠는 전면, 머그는 평면 인쇄 영역을 보여주는 개념 목업이다. 아크릴은 사각 규격이며 자유형 칼선·화이트 인쇄판은 범위 밖이다. 생성 PNG는 300 DPI 기준 픽셀 크기와 메타데이터를 가진 검토용 출력이다. 제작사별 도련·색상 프로파일·재단선·화이트 잉크 및 실물 샘플 승인이 끝나기 전 생산에 사용하지 않는다.

확장: Product별 printAreas, version, supplierId를 도입하고 Design의 layers와 sourceType(upload/ai/licensed)를 확장한다. AI job, IP asset, license grant는 별도 엔티티로 분리해 구매 시 권리·비용 스냅샷을 저장한다.

실결제 전: 사업자·약관·개인정보·환불·맞춤제작 동의, 토스 계약과 테스트, 주소 검색, 접근 속도 제한, 모니터링, 만료 주문 정리, 인증·비밀번호 회복, 결제 웹훅 검증과 대사, 취소·환불, 배송 추적, 저장소 백업을 완료한다. 현재는 로컬 검증용이고 공개 운영용 출시가 아니다.

## 도메인 전환
AWS 네임서버가 누구 소유인지는 아직 검증하지 않았다. 기존 DNS의 A/AAAA/CNAME/MX/TXT(SPF·DKIM·DMARC)/검증 레코드를 먼저 내보내고 가비아 존에 복제한다. 네이버웍스 등 메일 레코드를 반드시 보존한다. 가비아 계정 화면에 표시된 정확한 네임서버를 확인해 사용한다. 새 호스팅 준비 후 가비아 존에 루트·www 레코드와 TLS를 구성하고 TTL·전파·메일 송수신을 점검한다. 기존 값과 롤백 절차를 보관한다. 이 프로젝트 작업에서 DNS 변경이나 굿즈베이커리 해지 통보는 실행하지 않았다.

참고: https://www.marpple.com/kr/ , https://docs.tosspayments.com/guides/v2/payment-widget/integration
