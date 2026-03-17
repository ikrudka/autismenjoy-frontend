import React, { useState, useEffect } from 'react';
import { io } from 'socket.io-client';

const SERVER_URL = 'https://autismenjoy.onrender.com';

const socket = io(SERVER_URL, {
  transports: ['websocket', 'polling'],
});

const COLOR_MAP = { red: 'text-red-600', black: 'text-gray-900', blue: 'text-blue-600', yellow: 'text-yellow-500', false: 'text-green-600' };
const RACK_COLS = 15; 
const TURN_DURATION = 30000;

const getOrCreatePlayerKey = () => {
  try {
    const existing = localStorage.getItem('okey_playerKey');
    if (existing) return existing;
    const key = (crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(16).slice(2)}`);
    localStorage.setItem('okey_playerKey', key);
    return key;
  } catch {
    return `ephemeral_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }
};

export default function App() {
  const playerKey = getOrCreatePlayerKey();
  const [userName, setUserName] = useState('');
  const [roomInput, setRoomInput] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [room, setRoom] = useState(null);
  const [selectedTiles, setSelectedTiles] = useState([]);
  const [errorMsg, setErrorMsg] = useState('');
  const [timeProgress, setTimeProgress] = useState(100);
  const [connState, setConnState] = useState(socket.connected ? 'connected' : 'connecting');
  const [hoverTarget, setHoverTarget] = useState(null); // { playerId, groupIndex } | null

  useEffect(() => {
    socket.on('roomUpdate', (data) => {
      setRoom(data);
      setErrorMsg('');
      
      setSelectedTiles(prev => {
        if (!data || !data.hands || !socket || !socket.id) return prev;
        const myHand = data.hands[socket.id] || [];
        const validIds = myHand.filter(Boolean).map(t => t.id);
        const filtered = prev.filter(id => validIds.includes(id));
        if (filtered.length === prev.length) return prev; 
        return filtered;
      });
    });

    socket.on('error', (msg) => {
      setErrorMsg(msg);
      setTimeout(() => setErrorMsg(''), 4000);
    });

    const onConnect = () => setConnState('connected');
    const onDisconnect = () => setConnState('disconnected');
    const onConnectError = () => setConnState('disconnected');
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);

    return () => {
      socket.off('roomUpdate');
      socket.off('error');
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
    };
  }, []);

  useEffect(() => {
    if (!room || room.status !== 'playing') return;
    const interval = setInterval(() => {
      const elapsed = Date.now() - room.turnStartTime;
      const remaining = Math.max(0, TURN_DURATION - elapsed);
      setTimeProgress((remaining / TURN_DURATION) * 100);
    }, 100);
    return () => clearInterval(interval);
  }, [room?.turnStartTime, room?.status]);

  const createRoom = () => {
    if (!userName.trim()) return setErrorMsg("İsim giriniz.");
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    setRoomCode(code);
    socket.emit('joinRoom', { roomCode: code, userName, playerKey });
  };

  const joinRoom = () => {
    if (!userName.trim() || !roomInput.trim()) return setErrorMsg("İsim ve Oda Kodu giriniz.");
    const code = roomInput.toUpperCase();
    setRoomCode(code);
    socket.emit('joinRoom', { roomCode: code, userName, playerKey });
  };

  const startGame = () => socket.emit('startGame', roomCode);
  const drawFromDeck = () => socket.emit('drawFromDeck', roomCode);
  const drawFromDiscard = (targetId) => socket.emit('drawFromDiscard', { roomCode, targetId });
  const sortMyHand = () => socket.emit('sortHand', roomCode);
  
  const handleDropOnRack = (e, targetIndex) => {
    e.preventDefault(); e.stopPropagation();
    const sourceData = e.dataTransfer.getData('text/plain');
    if (!sourceData) return;
    socket.emit('moveTileOnRack', { roomCode, sourceIndex: parseInt(sourceData, 10), targetIndex });
  };

  const handleDropOnDiscard = (e) => {
    e.preventDefault(); e.stopPropagation();
    const sourceData = e.dataTransfer.getData('text/plain');
    if (!sourceData) return;
    socket.emit('discardTile', { roomCode, sourceIndex: parseInt(sourceData, 10) });
    setSelectedTiles([]);
  };

  const handleDropOnTableGroup = (e, targetPlayerId, groupIndex) => {
    e.preventDefault(); e.stopPropagation();
    const sourceData = e.dataTransfer.getData('text/plain');
    if (!sourceData) return;
    socket.emit('processTile', { roomCode, sourceIndex: parseInt(sourceData, 10), targetPlayerId, groupIndex });
    setSelectedTiles([]);
    setHoverTarget(null);
  };

  const tryProcessSelectedToGroup = (targetPlayerId, groupIndex) => {
    if (!room?.hands?.[socket.id]) return;
    if (!room?.hasOpened?.[socket.id]) return setErrorMsg('Önce barajı (101) aşmalısın.');
    if (room?.players?.[room.turn]?.id !== socket.id) return setErrorMsg('Sıra sende değil!');
    if (selectedTiles.length !== 1) return setErrorMsg('Taş işlemek için 1 taş seçmelisin.');
    const tileId = selectedTiles[0];
    const myHand = room.hands[socket.id];
    const sourceIndex = myHand.findIndex(t => t && t.id === tileId);
    if (sourceIndex === -1) return setErrorMsg('Seçtiğin taş ıstakada yok.');
    socket.emit('processTile', { roomCode, sourceIndex, targetPlayerId, groupIndex });
    setSelectedTiles([]);
  };

  const openToTable = () => {
    if (selectedTiles.length < 3) return setErrorMsg("En az 3 taş seçmelisin!");
    let myHand = room.hands[socket.id];
    let groupToOpen = selectedTiles.map(id => myHand.find(t => t && t.id === id)).filter(Boolean);
    socket.emit('openToTable', { roomCode, openedGroup: groupToOpen });
    setSelectedTiles([]);
  };

  const openDouble = () => {
    if (selectedTiles.length < 2) return setErrorMsg("Çift açmak için taş seçmelisin!");
    socket.emit('openDouble', { roomCode, selectedTileIds: selectedTiles });
    setSelectedTiles([]);
  };

  const takeBackGroup = (groupIndex) => socket.emit('takeBackGroup', { roomCode, groupIndex });
  const toggleSelect = (id) => setSelectedTiles(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  const isOkey = (t) => room && room.okeyTile && t.color === room.okeyTile.color && t.value === room.okeyTile.value;

  if (!room || room.status === 'waiting') {
    return (
      <div className="min-h-screen bg-green-900 text-white flex items-center justify-center p-4">
        <div className="bg-green-800 p-8 rounded-xl shadow-2xl w-full max-w-md">
          <h1 className="text-4xl font-bold mb-8 text-center text-yellow-400">101 Okey</h1>
          <div className="text-center text-xs mb-4 opacity-80">
            Bağlantı: <b className={connState === 'connected' ? 'text-green-300' : connState === 'connecting' ? 'text-yellow-300' : 'text-red-300'}>{connState}</b>
          </div>
          {!room ? (
            <>
              <input className="w-full p-3 mb-4 text-black rounded" placeholder="Adınız" value={userName} onChange={e => setUserName(e.target.value)} />
              <button onClick={createRoom} className="w-full bg-yellow-600 p-3 rounded font-bold text-black mb-4">Oda Kur</button>
              <div className="flex gap-2">
                <input className="flex-1 p-3 text-black rounded" placeholder="Oda Kodu" value={roomInput} onChange={e => setRoomInput(e.target.value)} />
                <button onClick={joinRoom} className="bg-blue-600 px-6 rounded font-bold">Katıl</button>
              </div>
            </>
          ) : (
            <div className="text-center">
              <h2 className="text-2xl mb-4">Oda: <span className="text-yellow-400 font-bold">{roomCode}</span></h2>
              <div className="bg-green-950 p-4 rounded mb-4">
                {room.players.map((p, i) => (
                  <div key={i} className="py-1 flex items-center justify-between gap-3">
                    <span className="truncate">{p.name}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${p.connected === false ? 'bg-red-900/70 text-red-200' : 'bg-green-900/60 text-green-200'}`}>
                      {p.connected === false ? 'offline' : 'online'}
                    </span>
                  </div>
                ))}
              </div>
              {room.players[0].id === socket.id && <button onClick={startGame} className="w-full bg-yellow-600 p-3 rounded font-bold text-black">Başlat</button>}
            </div>
          )}
          {errorMsg && <p className="text-red-400 mt-4 text-center font-bold">{errorMsg}</p>}
        </div>
      </div>
    );
  }

  if (room.status === 'finished') {
    return (
      <div className="min-h-screen bg-green-900 text-white flex flex-col items-center justify-center p-4">
        <h1 className="text-5xl font-bold text-yellow-400 mb-8">El Bitti!</h1>
        <div className="bg-green-800 p-8 rounded-xl shadow-2xl w-full max-w-md">
          <h2 className="text-2xl font-bold mb-4 border-b border-green-700 pb-2">Skor Tablosu (Toplam Puan)</h2>
          {room.players.map(p => (
            <div key={p.id} className="flex justify-between py-2 text-lg">
              <span>{p.name}</span>
              <span className={`font-bold ${room.scores[p.id] < 0 ? 'text-green-400' : 'text-red-400'}`}>
                {room.scores[p.id]}
              </span>
            </div>
          ))}
          <div className="flex gap-4 mt-8">
             {room.players[0].id === socket.id && (
                <button onClick={() => socket.emit('restartGame', roomCode)} className="flex-1 bg-yellow-600 text-black p-3 rounded font-bold hover:bg-yellow-500">Yeni El Başlat</button>
             )}
             <button onClick={() => window.location.reload()} className="flex-1 bg-blue-600 hover:bg-blue-500 p-3 rounded font-bold">Lobiye Çık</button>
          </div>
        </div>
      </div>
    );
  }

  const myIdx = room.players.findIndex(p => p.id === socket.id);
  const opponents = [];
  for (let i = 1; i < room.players.length; i++) opponents.push(room.players[(myIdx + i) % room.players.length]);

  let topPlayer = null, leftPlayer = null, rightPlayer = null;
  if (opponents.length === 1) topPlayer = opponents[0];
  else if (opponents.length === 2) { rightPlayer = opponents[0]; leftPlayer = opponents[1]; }
  else if (opponents.length === 3) { rightPlayer = opponents[0]; topPlayer = opponents[1]; leftPlayer = opponents[2]; }

  const myTableSum = room.playerTables[socket.id]?.reduce((sum, group) => {
    return sum + group.reduce((gSum, t) => {
       if (t.color === 'false' && room.okeyTile) return gSum + room.okeyTile.value;
       if (isOkey(t)) return gSum; 
       return gSum + t.value;
    }, 0);
  }, 0) || 0;

  const selectedSum = selectedTiles.reduce((sum, id) => {
    const tile = room.hands[socket.id]?.find(t => t && t.id === id);
    if(!tile) return sum;
    if(tile.color === 'false' && room.okeyTile) return sum + room.okeyTile.value;
    if(isOkey(tile)) return sum; 
    return sum + tile.value;
  }, 0);

  return (
    <div className="h-screen w-screen bg-green-900 text-white overflow-hidden relative font-sans select-none">
      
      {topPlayer && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 flex flex-col items-center">
          <div className="relative mb-1">
             <div className={`px-4 py-1 rounded-full flex items-center gap-2 ${room.players[room.turn].id === topPlayer.id ? 'bg-yellow-500 text-black font-bold' : 'bg-green-950'}`}>
               <span className={`w-2 h-2 rounded-full ${topPlayer.connected === false ? 'bg-red-400' : 'bg-green-400'}`} />
               <span>{topPlayer.name}</span>
             </div>
             {room.players[room.turn].id === topPlayer.id && (
                <div className="absolute -bottom-1 left-0 h-1 bg-red-500 rounded-full" style={{ width: `${timeProgress}%`, transition: 'width 0.1s linear' }} />
             )}
          </div>
          <div className="flex flex-wrap justify-center gap-1 bg-green-800/50 p-2 rounded-lg min-w-[200px] min-h-[50px] mb-1">
             {room.playerTables[topPlayer.id]?.map((g, i) => (
                <div
                  key={i}
                  onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect="copy"; setHoverTarget({ playerId: topPlayer.id, groupIndex: i }); }}
                  onDragLeave={() => setHoverTarget(null)}
                  onDrop={(e) => handleDropOnTableGroup(e, topPlayer.id, i)}
                  onClick={() => tryProcessSelectedToGroup(topPlayer.id, i)}
                  className={`flex gap-0.5 bg-black/30 p-2 rounded transition-all ${hoverTarget?.playerId === topPlayer.id && hoverTarget?.groupIndex === i ? 'ring-2 ring-yellow-300 bg-blue-900/30' : 'hover:ring-2 hover:ring-blue-400'}`}
                  title="Taş işlemek için taş seçip buraya dokun / sürükle"
                >
                   <TileRow group={g} small isOkey={isOkey} />
                </div>
             ))}
          </div>
          <div className="flex gap-1 bg-[#6b4226] p-1.5 rounded-lg opacity-80">
             {Array(Math.min(22, room.hands[topPlayer.id]?.filter(t=>t).length || 0)).fill(0).map((_,i) => <div key={i} className="w-4 h-6 bg-stone-200 rounded-sm"></div>)}
          </div>
        </div>
      )}

      {leftPlayer && (
        <div className="absolute left-2 top-1/2 -translate-y-1/2 flex flex-row items-center gap-2">
          <div className="flex flex-col items-center relative">
            <div className={`px-4 py-1 rounded-full mb-2 whitespace-nowrap flex items-center gap-2 ${room.players[room.turn].id === leftPlayer.id ? 'bg-yellow-500 text-black font-bold' : 'bg-green-950'}`}>
              <span className={`w-2 h-2 rounded-full ${leftPlayer.connected === false ? 'bg-red-400' : 'bg-green-400'}`} />
              <span>{leftPlayer.name}</span>
            </div>
            {room.players[room.turn].id === leftPlayer.id && (
               <div className="absolute top-8 left-0 h-1 bg-red-500 rounded-full" style={{ width: `${timeProgress}%`, transition: 'width 0.1s linear' }} />
            )}
          </div>
          <div className="flex flex-col gap-1 bg-green-800/50 p-3 rounded-lg min-w-[80px] min-h-[120px]">
             {room.playerTables[leftPlayer.id]?.map((g, i) => (
                <div
                  key={i}
                  onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect="copy"; setHoverTarget({ playerId: leftPlayer.id, groupIndex: i }); }}
                  onDragLeave={() => setHoverTarget(null)}
                  onDrop={(e) => handleDropOnTableGroup(e, leftPlayer.id, i)}
                  onClick={() => tryProcessSelectedToGroup(leftPlayer.id, i)}
                  className={`flex gap-0.5 bg-black/30 p-2 rounded transition-all ${hoverTarget?.playerId === leftPlayer.id && hoverTarget?.groupIndex === i ? 'ring-2 ring-yellow-300 bg-blue-900/30' : 'hover:ring-2 hover:ring-blue-400'}`}
                  title="Taş işlemek için taş seçip buraya dokun / sürükle"
                >
                   <TileRow group={g} small isOkey={isOkey} />
                </div>
             ))}
          </div>
        </div>
      )}

      {rightPlayer && (
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex flex-row-reverse items-center gap-2">
          <div className="flex flex-col items-center relative">
            <div className={`px-4 py-1 rounded-full mb-2 whitespace-nowrap flex items-center gap-2 ${room.players[room.turn].id === rightPlayer.id ? 'bg-yellow-500 text-black font-bold' : 'bg-green-950'}`}>
              <span className={`w-2 h-2 rounded-full ${rightPlayer.connected === false ? 'bg-red-400' : 'bg-green-400'}`} />
              <span>{rightPlayer.name}</span>
            </div>
            {room.players[room.turn].id === rightPlayer.id && (
               <div className="absolute top-8 left-0 h-1 bg-red-500 rounded-full" style={{ width: `${timeProgress}%`, transition: 'width 0.1s linear' }} />
            )}
          </div>
          <div className="flex flex-col gap-1 bg-green-800/50 p-3 rounded-lg min-w-[80px] min-h-[120px]">
             {room.playerTables[rightPlayer.id]?.map((g, i) => (
                <div
                  key={i}
                  onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect="copy"; setHoverTarget({ playerId: rightPlayer.id, groupIndex: i }); }}
                  onDragLeave={() => setHoverTarget(null)}
                  onDrop={(e) => handleDropOnTableGroup(e, rightPlayer.id, i)}
                  onClick={() => tryProcessSelectedToGroup(rightPlayer.id, i)}
                  className={`flex gap-0.5 bg-black/30 p-2 rounded transition-all ${hoverTarget?.playerId === rightPlayer.id && hoverTarget?.groupIndex === i ? 'ring-2 ring-yellow-300 bg-blue-900/30' : 'hover:ring-2 hover:ring-blue-400'}`}
                  title="Taş işlemek için taş seçip buraya dokun / sürükle"
                >
                   <TileRow group={g} small isOkey={isOkey} />
                </div>
             ))}
          </div>
        </div>
      )}

      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex gap-10 items-center bg-green-900/50 p-4 rounded-3xl shadow-2xl">
        <div onClick={drawFromDeck} className="w-12 h-16 bg-white text-black rounded flex items-center justify-center font-bold cursor-pointer shadow-xl border-b-4 border-gray-300 hover:-translate-y-1 relative">
          <span className="absolute -top-3 -right-3 bg-red-600 text-white text-xs rounded-full w-6 h-6 flex items-center justify-center">{room.deck.length}</span>
          Deste
        </div>
        <div>
          <span className="text-xs text-green-300 absolute -top-4">Gösterge</span>
          <Tile t={room.indicator} small disabled />
        </div>
      </div>

      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 w-full max-w-6xl">
        
        <div className="flex flex-wrap gap-2 bg-green-800/30 p-4 rounded-xl min-w-[300px] min-h-[70px] justify-center items-end border border-green-700/50">
          {room.playerTables[socket.id]?.map((group, i) => (
             <div
               key={i}
               onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect="copy"; setHoverTarget({ playerId: socket.id, groupIndex: i }); }}
               onDragLeave={() => setHoverTarget(null)}
               onDrop={(e) => handleDropOnTableGroup(e, socket.id, i)}
               onClick={() => {
                 const isMyTurn = room?.players?.[room.turn]?.id === socket.id;
                 if (!room.hasOpened?.[socket.id]) {
                   // Geri alma sadece kendi sıranda anlamlı; aksi halde hata spam olmasın.
                   if (isMyTurn) return takeBackGroup(i);
                   return;
                 }
                 tryProcessSelectedToGroup(socket.id, i);
               }}
               className={`flex bg-black/40 p-2 rounded gap-1 transition-all ${hoverTarget?.playerId === socket.id && hoverTarget?.groupIndex === i ? 'ring-2 ring-yellow-300 bg-blue-900/30' : 'hover:ring-2 hover:ring-blue-400'} ${!room.hasOpened?.[socket.id] ? 'cursor-pointer hover:bg-red-900/50' : 'cursor-pointer'}`}
               title={!room.hasOpened?.[socket.id] ? 'Geri Al / Taş İşle' : 'Taş işlemek için taş seçip buraya dokun / sürükle'}
             >
               <TileRow group={group} small isOkey={isOkey} />
             </div>
          ))}
          {room.playerTables[socket.id]?.length === 0 && <span className="text-green-500/50 text-sm">Açılan perler burada görünür</span>}
        </div>

        <div className="flex items-end gap-2 md:gap-4 w-full px-2">
          {leftPlayer ? (
            <div className="text-center text-xs md:text-sm text-green-300 font-bold bg-green-950/50 p-2 rounded-lg">
              Solun Attığı
              <div onClick={() => drawFromDiscard(leftPlayer.id)} className="mt-2 cursor-pointer hover:-translate-y-1 transition-transform">
                {room.discards[leftPlayer.id]?.length > 0 ? <Tile t={room.discards[leftPlayer.id][room.discards[leftPlayer.id].length - 1]} small disabled /> : <div className="w-8 h-12 border-2 border-dashed border-green-500/50 rounded mx-auto"></div>}
              </div>
            </div>
          ) : topPlayer && (
            <div className="text-center text-xs md:text-sm text-green-300 font-bold bg-green-950/50 p-2 rounded-lg">
              {topPlayer.name} Attığı
              <div onClick={() => drawFromDiscard(topPlayer.id)} className="mt-2 cursor-pointer hover:-translate-y-1 transition-transform">
                {room.discards[topPlayer.id]?.length > 0 ? <Tile t={room.discards[topPlayer.id][room.discards[topPlayer.id].length - 1]} small disabled /> : <div className="w-8 h-12 border-2 border-dashed border-green-500/50 rounded mx-auto"></div>}
              </div>
            </div>
          )}

          <div className="flex-1 bg-[#8b5a2b] p-3 rounded-xl border-t-8 border-[#6b4226] shadow-2xl relative">
            
            <div className="flex justify-between items-center mb-2 gap-4">
              <div className="flex items-center gap-4 relative">
                <div className={`px-4 py-1.5 rounded text-sm font-bold shadow-inner ${room.players[room.turn].id === socket.id ? 'bg-yellow-400 text-black' : 'bg-[#52321c] text-white'}`}>
                  Sen: {userName}
                </div>
                {room.players[room.turn].id === socket.id && (
                   <div className="absolute -bottom-2 left-0 h-1.5 bg-red-500 rounded-full" style={{ width: `${timeProgress}%`, transition: 'width 0.1s linear' }} />
                )}
                <div className="bg-[#52321c] text-yellow-100 px-3 py-1.5 rounded text-xs shadow-inner flex gap-3">
                   <span title="Istakada seçilen taşların toplamı">Seçili: <b className="text-blue-300">{selectedSum}</b></span>
                   <span>Masa: <b className={myTableSum >= 101 ? 'text-green-400' : 'text-red-400'}>{myTableSum}</b></span>
                </div>
              </div>

              {errorMsg && <div className="text-red-300 font-bold bg-red-900/90 px-3 py-1 rounded text-sm shadow-lg absolute -top-12 left-1/2 -translate-x-1/2 z-50 whitespace-nowrap">{errorMsg}</div>}
              
              <div className="flex gap-2 items-center">
                <button onClick={openToTable} className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded text-sm font-bold shadow">Per Aç</button>
                <button onClick={openDouble} className="bg-purple-600 hover:bg-purple-500 text-white px-3 py-1.5 rounded text-sm font-bold shadow">Çift Aç</button>
                <button onClick={sortMyHand} className="bg-[#3d2514] hover:bg-black text-white px-3 py-1.5 rounded text-sm font-bold shadow">Sırala</button>
              </div>
            </div>
            {selectedTiles.length === 1 && room.hasOpened?.[socket.id] && (
              <div className="mt-2 text-xs text-yellow-100/90">
                Taş işlemek için bir pere dokunabilir veya sürükleyebilirsin.
              </div>
            )}

            <div className="overflow-x-auto no-scrollbar pb-1">
              <div className="grid gap-1 min-w-max" style={{ gridTemplateColumns: `repeat(${RACK_COLS}, 3.5rem)` }}>
                {room.hands[socket.id]?.map((t, index) => (
                  <div key={`slot-${index}`} onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "move"; }} onDrop={(e) => handleDropOnRack(e, index)} className="w-14 h-[5.5rem] bg-[#52321c]/50 rounded flex items-center justify-center relative shadow-inner border border-[#3d2514]/30">
                    {t && (
                      <div draggable onDragStart={(e) => { e.stopPropagation(); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData('text/plain', index.toString()); }} onClick={(e) => { e.stopPropagation(); toggleSelect(t.id); }} className={`cursor-grab active:cursor-grabbing w-full h-full flex items-center justify-center ${selectedTiles.includes(t.id) ? '-translate-y-3 shadow-xl' : ''}`}>
                        <Tile t={t} selected={selectedTiles.includes(t.id)} isOkey={isOkey(t)} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <div className="text-center text-xs md:text-sm text-yellow-300 font-bold bg-green-950/50 p-2 rounded-lg">
              Senin Attığın
              <div onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "move"; }} onDrop={handleDropOnDiscard} className="mt-2 flex items-center justify-center w-8 h-12 md:w-16 md:h-24 border-2 border-dashed border-red-500/60 bg-red-900/40 rounded shadow-lg hover:bg-red-800/50 mx-auto">
                {room.discards[socket.id]?.length > 0 ? (
                  <div className="scale-75 md:scale-90 pointer-events-none"><Tile t={room.discards[socket.id][room.discards[socket.id].length - 1]} disabled isOkey={false}/></div>
                ) : <span className="text-[10px] md:text-xs opacity-50 text-red-200">Buraya At</span>}
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

function TileRow({ group, small, isOkey }) {
  return group.map(t => <Tile key={t.id} t={t} small={small} disabled isOkey={isOkey(t)} />);
}

function Tile({ t, small, selected, disabled, isOkey }) {
  if (!t) return null;
  return (
    <div className={`bg-stone-100 rounded flex items-center justify-center font-bold border-b-4 border-stone-300 shadow-md pointer-events-none ${disabled ? '' : 'hover:brightness-110 pointer-events-auto'} ${small ? 'w-7 h-10 text-base border-b-2' : 'w-full h-full text-2xl'} ${selected ? 'ring-4 ring-blue-500' : ''} ${isOkey ? 'ring-4 ring-yellow-400 shadow-[0_0_15px_rgba(250,204,21,0.8)]' : ''}`}>
      {t.color === 'false' ? (
         <span className="text-green-700 text-[10px] text-center leading-tight">Sahte<br/>Okey</span>
      ) : (
         <span className={COLOR_MAP[t.color]}>{t.value}</span>
      )}
    </div>
  );
}